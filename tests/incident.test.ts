import { describe, it, expect, beforeAll } from "vitest";
import { CRED_TYPE } from "../packages/core/crypto";
import { buildInput, prove, type ProofRequest, type SignedCredential, type ZkProof } from "../packages/core/prover";
import { buildWorld, CODES, DEPTH, T_DECLARED, T_LEGACY, WINDOW_END, WINDOW_START } from "../packages/core/fixtures";
import { NonceStore, verifyPresentation, type VerifierRequest, type VerificationResult } from "../packages/core/verify";
import { declareCompromise, incidentSummary } from "../packages/core/incident";
import { IssuanceLog } from "../packages/core/merkle";
import { makeAnchor } from "../packages/core/notary";
import { adminKeyFromSeed, type SignedRegistry } from "../packages/core/registry";

type W = Awaited<ReturnType<typeof buildWorld>>;
let w: W; let v2: SignedRegistry; let epoch2: ReturnType<W["c"]["keyFromSeed"]>;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const mk = (nonce: bigint): VerifierRequest => ({ ageCutoff: 20050101n, requiredDegree: CODES.CS_DEGREE, requiredLicense: CODES.MEDICAL, today: 20261025n, nonce, onStatusUnavailable: "reject", requiredIssuers: { degree: "uni-x" } });
const step = (r: VerificationResult, id: string) => r.steps.find((s) => s.id === id)!;

async function check(reg: SignedRegistry, pinned: SignedRegistry | undefined, deg: SignedCredential, nonce: bigint, extraLists: any[] = []) {
  const req = mk(nonce);
  const p: ZkProof = await prove(buildInput(w.holderSecret, w.creds.id, deg, w.creds.license, req));
  const nonces = new NonceStore(); nonces.issue(NOW, nonce);
  return verifyPresentation(p, req, { crypto: w.c, registry: reg, pinnedRegistry: pinned, adminPub: w.admin.pub, anchors: w.anchors, notaryPub: w.notary.pub, statusLists: w.lists({}, extraLists), nonces, now: NOW + 1000 });
}

beforeAll(async () => {
  w = await buildWorld();
  epoch2 = w.c.keyFromSeed("uni-x-epoch2");
  v2 = declareCompromise(w.registry, {
    issuerId: "uni-x", keyId: w.keyIdOf(w.keys["uni-x"]), windowStart: WINDOW_START, windowEnd: WINDOW_END,
    reason: "simulated issuance-key theft",
    replacementKey: { keyId: w.keyIdOf(epoch2), pub: { Ax: epoch2.pub.Ax.toString(), Ay: epoch2.pub.Ay.toString() }, epoch: 2, status: "active" },
  }, w.admin.priv, T_DECLARED);
}, 60000);

describe("48-hour university key compromise", () => {
  it("BEFORE the declaration: the legacy degree AND the thief's fake degree are both accepted (nobody knows yet)", async () => {
    const fake = w.fraudDegree();
    expect((await check(w.registry, undefined, w.creds.degree, 1n)).verdict).toBe("accepted");
    expect((await check(w.registry, undefined, fake, 2n)).verdict).toBe("accepted");
  }, 120000);

  it("AFTER: the fake degree (anchored inside the window) is quarantined", async () => {
    const r = await check(v2, w.registry, w.fraudDegree(), 3n);
    expect(r.verdict).toBe("quarantined");
    expect(step(r, "trust-degree").detail).toContain("QUARANTINED");
    expect(step(r, "trust-identity").outcome).toBe("pass"); // innocent credentials untouched
    expect(step(r, "trust-license").outcome).toBe("pass");
  }, 120000);

  it("AFTER: the legitimate legacy degree (same compromised key, notarized before the window) is preserved", async () => {
    const r = await check(v2, w.registry, w.creds.degree, 4n);
    expect(r.verdict).toBe("accepted");
    expect(step(r, "trust-degree").detail).toContain("PRESERVED");
    expect(step(r, "status-degree").outcome).toBe("pass"); // revocation still enforced on preserved credentials
  }, 120000);

  it("AFTER: a degree re-issued under the replacement key (epoch 2) is accepted", async () => {
    const log = new IssuanceLog(w.c, DEPTH);
    const i = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 12n, 123n, { key: epoch2, log });
    const a = makeAnchor(w.keyIdOf(epoch2), log.rootAt(), log.size, w.notary.priv, "2026-10-25T11:30:00.000Z");
    w.anchors.push(a);
    const r = await check(v2, w.registry, w.present(i, a), 5n, [{ issuerId: "uni-x", key: epoch2 }]);
    expect(r.verdict).toBe("accepted");
    expect(step(r, "trust-degree").detail).toContain("epoch 2");
  }, 120000);

  it("AFTER: a compromised-key credential with NO notarized evidence is quarantined, not silently accepted", async () => {
    const log = new IssuanceLog(w.c, DEPTH); // never anchored by the notary
    const i = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 13n, 131n, { log });
    const r = await check(v2, w.registry, w.present(i, makeAnchor("x", log.rootAt(), log.size, w.notary.priv, T_LEGACY)), 6n);
    expect(r.verdict).toBe("quarantined");
    expect(step(r, "trust-degree").detail).toContain("no notarized issuance evidence");
  }, 120000);

  it("a thief cannot backdate: the anchor time comes from the notary, not the credential, and a forged anchor is ignored", async () => {
    const log = new IssuanceLog(w.c, DEPTH);
    const i = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 14n, 141n, { log });
    const fakeNotary = adminKeyFromSeed("attacker-notary");
    const bad = makeAnchor(w.keyIdOf(w.keys["uni-x"]), log.rootAt(), log.size, fakeNotary.priv, T_LEGACY); // claims to be old
    w.anchors.push(bad);
    const r = await check(v2, w.registry, w.present(i, bad), 7n);
    expect(r.verdict).toBe("quarantined");
  }, 120000);

  it("incident summary is privacy-safe: counts and times only", () => {
    const rec = v2.body.issuers.find((x) => x.issuerId === "uni-x")!.keys[0].compromise!;
    const sum = incidentSummary(w.keyIdOf(w.keys["uni-x"]), rec, w.anchors, w.notary.pub);
    expect(sum.trustedAnchors).toBeGreaterThanOrEqual(1);
    expect(sum.suspectAnchors).toBeGreaterThanOrEqual(1);
    expect(sum.lastTrustedAnchor).toBe(T_LEGACY);
    const dump = JSON.stringify(sum) + JSON.stringify(v2.body);
    for (const v of ["19950315", w.holderSecret.toString(), "Alice"]) expect(dump).not.toContain(v);
  });
});
