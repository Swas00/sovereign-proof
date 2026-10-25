import { describe, it, expect, beforeAll } from "vitest";
import { buildInput, prove, type ZkProof } from "../packages/core/prover";
import { buildWorld, CODES, DEPTH, SIZE, T_LEGACY } from "../packages/core/fixtures";
import { buildStatusList } from "../packages/core/status";
import { NonceStore, verifyPresentation, type VerifierRequest } from "../packages/core/verify";
import { CRED_TYPE } from "../packages/core/crypto";
import { IssuanceLog } from "../packages/core/merkle";
import { publishNext, acceptRegistry, adminKeyFromSeed, canonical, sha256hex } from "../packages/core/registry";

type W = Awaited<ReturnType<typeof buildWorld>>;
let w: W; let base: ZkProof; let baseReq: VerifierRequest;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const mkReq = (nonce: bigint, extra: Partial<VerifierRequest> = {}): VerifierRequest => ({
  ageCutoff: 20050101n, requiredDegree: CODES.CS_DEGREE, requiredLicense: CODES.MEDICAL, today: 20261025n, nonce,
  onStatusUnavailable: "reject", requiredIssuers: { degree: "uni-x" }, ...extra,
});
const ctxFor = (nonce: bigint, over: Partial<Parameters<typeof verifyPresentation>[2]> = {}) => {
  const nonces = new NonceStore(); nonces.issue(NOW, nonce);
  return { crypto: w.c, registry: w.registry, adminPub: w.admin.pub, anchors: w.anchors, notaryPub: w.notary.pub, statusLists: w.lists(), nonces, now: NOW + 1000, ...over };
};
const step = (r: Awaited<ReturnType<typeof verifyPresentation>>, id: string) => r.steps.find((s) => s.id === id)!;

beforeAll(async () => {
  w = await buildWorld();
  baseReq = mkReq(1001n);
  base = await prove(buildInput(w.holderSecret, w.creds.id, w.creds.degree, w.creds.license, baseReq));
}, 120000);

describe("verifier pipeline", () => {
  it("accepts a valid compound presentation and discloses only issuers + policy", async () => {
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n));
    expect(r.verdict).toBe("accepted");
    expect(r.steps.every((s) => s.outcome === "pass")).toBe(true);
    expect(r.disclosed.issuers.map((i) => i.issuerId)).toEqual(["gov-id", "uni-x", "med-board"]);
    const dump = JSON.stringify(r);
    for (const v of ["19950315", "20300101", "20180601", w.holderSecret.toString(), "Alice", "Verma", "Harbor"]) expect(dump).not.toContain(v);
  });
  it("rejects replay of the same proof", async () => {
    const ctx = ctxFor(1001n);
    expect((await verifyPresentation(base, baseReq, ctx)).verdict).toBe("accepted");
    const again = await verifyPresentation(base, baseReq, ctx);
    expect(again.verdict).toBe("rejected");
    expect(step(again, "nonce").detail).toContain("replayed");
  });
  it("rejects an expired challenge and an unknown challenge", async () => {
    expect(step(await verifyPresentation(base, baseReq, ctxFor(1001n, { now: NOW + 10 * 60_000 })), "nonce").detail).toContain("expired");
    expect(step(await verifyPresentation(base, baseReq, ctxFor(5n)), "nonce").detail).toContain("unknown");
  });
  it("rejects a proof made for a weaker policy than the verifier asked", async () => {
    const weak = mkReq(1001n, { ageCutoff: 20150101n }); // over-11 instead of over-21
    const r = await verifyPresentation(base, weak, ctxFor(1001n));
    expect(r.verdict).toBe("rejected"); expect(step(r, "policy").outcome).toBe("fail");
  });
  it("rejects a valid proof signed by an issuer key not in the registry", async () => {
    const forgedLog = new IssuanceLog(w.c, DEPTH);
    const forgedI = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 2n, 22n, { key: w.attacker, log: forgedLog });
    const forged = w.present(forgedI, w.anchorLog(w.attacker, forgedLog, T_LEGACY));
    const req = mkReq(2002n);
    const p = await prove(buildInput(w.holderSecret, w.creds.id, forged, w.creds.license, req));
    const r = await verifyPresentation(p, req, ctxFor(2002n));
    expect(step(r, "zk").outcome).toBe("pass"); // the math is fine
    expect(r.verdict).toBe("rejected"); expect(step(r, "trust-degree").detail).toContain("not in the trust registry");
  });
  it("rejects a degree from the wrong university when the verifier pins one", async () => {
    const otherI = w.issue("uni-y", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 2n, 22n);
    const other = w.present(otherI, w.anchorLog(w.keys["uni-y"], w.logs["uni-y"], T_LEGACY));
    const req = mkReq(3003n);
    const p = await prove(buildInput(w.holderSecret, w.creds.id, other, w.creds.license, req));
    const r = await verifyPresentation(p, req, ctxFor(3003n));
    expect(r.verdict).toBe("rejected"); expect(step(r, "trust-degree").detail).toContain("requires uni-x");
    // ...but accepted when no pin is set
    const r2 = await verifyPresentation(p, mkReq(3003n, { requiredIssuers: undefined }), ctxFor(3003n));
    expect(r2.verdict).toBe("accepted");
  });
  it("rejects a revoked medical license", async () => {
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { statusLists: w.lists({ "med-board": [3] }) }));
    expect(r.verdict).toBe("rejected"); expect(step(r, "status-license").outcome).toBe("fail");
    expect(step(r, "status-degree").outcome).toBe("pass"); // unrelated credentials unaffected
  });
  it("fails closed when the status service is unavailable, warns when policy allows", async () => {
    const empty = new Map();
    expect((await verifyPresentation(base, baseReq, ctxFor(1001n, { statusLists: empty }))).verdict).toBe("rejected");
    const soft = await verifyPresentation(base, { ...baseReq, onStatusUnavailable: "warn" }, ctxFor(1001n, { statusLists: empty }));
    expect(soft.verdict).toBe("accepted"); expect(step(soft, "status-license").outcome).toBe("warn");
  });
  it("conservative policy: if the theft window opens BEFORE the legacy anchor, nothing can be proven and the degree is quarantined (unrelated issuers stay valid)", async () => {
    const v2 = publishNext(w.registry, (b) => {
      const k = b.issuers.find((i) => i.issuerId === "uni-x")!.keys[0];
      k.status = "compromised";
      k.compromise = { windowStart: "2026-09-15T00:00:00Z", windowEnd: "2026-10-25T10:00:00Z", reason: "simulated key theft" };
    }, w.admin.priv, "2026-10-25T11:00:00Z");
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { registry: v2, pinnedRegistry: w.registry }));
    expect(r.verdict).toBe("quarantined");
    expect(step(r, "trust-degree").outcome).toBe("quarantine");
    expect(step(r, "trust-identity").outcome).toBe("pass");
    expect(step(r, "trust-license").outcome).toBe("pass");
  });
});

describe("registry integrity", () => {
  it("rejects a registry edited without the admin key", () => {
    const evil = JSON.parse(JSON.stringify(w.registry)); evil.body.issuers[0].issuerId = "evil";
    expect(acceptRegistry(evil, w.admin.pub).ok).toBe(false);
  });
  it("rejects a registry signed by another key", () => {
    const other = publishNext(null, () => {}, adminKeyFromSeed("not-the-admin").priv, "x");
    expect(acceptRegistry(other, w.admin.pub).ok).toBe(false);
  });
  it("rejects rollback to an older version", () => {
    const v2 = publishNext(w.registry, () => {}, w.admin.priv, "2026-10-25T11:00:00Z");
    const r = acceptRegistry(w.registry, w.admin.pub, v2);
    expect(r.ok).toBe(false);
  });
});

describe("registry vs the public chain", () => {
  const rec = (v = 1, hash = w.registry.hash) => ({ version: v, hash });
  const run = (chain: any) => verifyPresentation(base, baseReq, ctxFor(1001n, { chain }));
  it("passes when the registry equals the latest chain record", async () => {
    const r = await run({ ok: true, blockNumber: 7, registry: [rec()] });
    expect(r.verdict).toBe("accepted"); expect(step(r, "chain").outcome).toBe("pass"); expect(step(r, "chain").detail).toContain("block 7");
  });
  it("rejects a stale registry (a validly signed older version while the chain has moved on)", async () => {
    const r = await run({ ok: true, registry: [rec(1), { version: 2, hash: "b".repeat(64) }] });
    expect(r.verdict).toBe("rejected"); expect(step(r, "chain").detail).toContain("stale");
  });
  it("rejects a registry whose hash differs from the chain's record (fork or tamper)", async () => {
    const r = await run({ ok: true, registry: [rec(1, "a".repeat(64))] });
    expect(r.verdict).toBe("rejected"); expect(step(r, "chain").detail).toContain("differs");
  });
  it("rejects a registry version the chain has never seen", async () => {
    const r = await run({ ok: true, registry: [] });
    expect(r.verdict).toBe("rejected"); expect(step(r, "chain").detail).toContain("no registry record");
  });
  it("fails closed when the chain is unreachable", async () => {
    const r = await run({ ok: false, error: "ECONNREFUSED", registry: [] });
    expect(r.verdict).toBe("rejected"); expect(step(r, "chain").detail).toContain("failing closed");
    expect(r.steps.map((s) => s.id)).not.toContain("zk"); // never reaches the proof when the trust root is unavailable
  });
});

describe("status lists vs the chain (rollback protection)", () => {
  const rec = (l: any) => ({ version: l.version, hash: sha256hex(canonical(l)) });
  const statusOf = (lists: Map<string, any>) => Object.fromEntries([...lists].map(([k, l]) => [k, rec(l)]));
  const chainWith = (status: any) => ({ ok: true, blockNumber: 9, registry: [{ version: 1, hash: w.registry.hash }], status });
  const medId = () => w.keyIdOf(w.keys["med-board"]);
  const revokedV2 = () => buildStatusList(w.c, w.keys["med-board"].prv, medId(), 2, SIZE, [3], T_LEGACY); // Alice's license slot is #3

  it("passes when every served list matches the issuer's record on the chain", async () => {
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { chain: chainWith(statusOf(w.lists())) }));
    expect(r.verdict).toBe("accepted"); expect(step(r, "status-license").detail).toContain("matches the issuer's record");
  });
  it("REJECTS a validly signed OLD list replayed to un-revoke a license (only the chain can tell)", async () => {
    const served = w.lists(); // v1: slot #3 NOT revoked, correctly signed
    const chain = chainWith({ ...statusOf(served), [medId()]: rec(revokedV2()) }); // the issuer has since published v2 revoking it
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { chain, statusLists: served }));
    expect(r.verdict).toBe("rejected"); expect(step(r, "status-license").detail).toContain("stale status list");
    expect(step(r, "status-degree").outcome).toBe("pass"); // unrelated issuers unaffected
  });
  it("...whereas without a chain record the same replay is ACCEPTED (this is the gap the chain closes)", async () => {
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { statusLists: w.lists() }));
    expect(r.verdict).toBe("accepted");
  });
  it("rejects a list whose content differs from the recorded hash for the same version", async () => {
    const served = w.lists();
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { chain: chainWith({ ...statusOf(served), [medId()]: { version: 1, hash: "c".repeat(64) } }), statusLists: served }));
    expect(r.verdict).toBe("rejected"); expect(step(r, "status-license").detail).toContain("differs");
  });
  it("rejects a list the issuer never recorded on the chain", async () => {
    const served = w.lists(); const partial = statusOf(served); delete partial[medId()];
    const r = await verifyPresentation(base, baseReq, ctxFor(1001n, { chain: chainWith(partial), statusLists: served }));
    expect(r.verdict).toBe("rejected"); expect(step(r, "status-license").detail).toContain("not recorded on the chain");
  });
});
