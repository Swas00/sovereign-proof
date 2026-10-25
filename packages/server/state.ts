import { CRED_TYPE } from "../core/crypto";
import { ACCOUNT, type Chain } from "./chain";
import { buildWorld, CODES, PEOPLE, DEPTH, T_DECLARED, T_FRAUD, T_REGISTRY, WINDOW_END, WINDOW_START } from "../core/fixtures";
import { IssuanceLog, rootFromPath } from "../core/merkle";
import { declareCompromise, incidentSummary } from "../core/incident";
import { NonceStore } from "../core/verify";
import { credToWire, type WireCred, type WireRequest } from "../core/wire";
import type { SignedRegistry } from "../core/registry";
import type { SignedCredential } from "../core/proofinput";

export type Phase = "normal" | "stolen" | "declared";
export interface Wallet { profile: "alice" | "mallory"; label: string; holderSecret: string; creds: WireCred[] }
export interface EventLog { t: string; type: string; detail: string }

export async function createState(chain: Chain) {
  const w = await buildWorld();
  const log: EventLog[] = [];
  const event = (type: string, detail: string) => log.push({ t: new Date().toISOString(), type, detail });
  const keyId = (k: { pub: any }) => w.keyIdOf(k);
  const rootOf = (i: { cred: any; log: IssuanceLog; index: number }, sc: SignedCredential) =>
    rootFromPath(w.c, w.c.commitment(i.cred.fields), sc.merkle);

  const mallorySecret = 1122334455n;
  const wrap = (role: WireCred["role"], label: string, issuerId: string, i: any, sc: SignedCredential) => credToWire(role, label, issuerId, rootOf(i, sc), sc);

  // Alice: legitimate holder, credentials notarized at T_LEGACY by buildWorld.
  const alice: Wallet = {
    profile: "alice", label: "Alice (legitimate holder)", holderSecret: w.holderSecret.toString(),
    creds: [
      { ...wrap("id", "National ID", "gov-id", w.legacy.id, w.creds.id), private: PEOPLE.alice },
      wrap("degree", "B.Sc. Computer Science, Northfield University", "uni-x", w.legacy.degree, w.creds.degree),
      wrap("license", "Medical license (MD)", "med-board", w.legacy.license, w.creds.license),
    ],
  };
  // Mallory: has a genuine ID and license but no real degree; the thief will hand her a fake one.
  const mId = w.issue("gov-id", CRED_TYPE.ID, 19900101n, w.c.identityBinding(PEOPLE.mallory.name, PEOPLE.mallory.address), 21n, 211n, { secret: mallorySecret });
  const mLic = w.issue("med-board", CRED_TYPE.LICENSE, CODES.MEDICAL, 20300101n, 23n, 233n, { secret: mallorySecret });
  const a1 = w.anchorLog(w.keys["gov-id"], w.logs["gov-id"], "2026-10-01T09:05:00.000Z");
  const a2 = w.anchorLog(w.keys["med-board"], w.logs["med-board"], "2026-10-01T09:05:00.000Z");
  const mallory: Wallet = {
    profile: "mallory", label: "Mallory (will receive a thief-issued degree)", holderSecret: mallorySecret.toString(),
    creds: [{ ...wrap("id", "National ID", "gov-id", mId, w.present(mId, a1)), private: PEOPLE.mallory }, wrap("license", "Medical license (MD)", "med-board", mLic, w.present(mLic, a2))],
  };

  // Each issuer's anchoring service account. The signing key and this account are separate credentials.
  const anchorer: Record<string, number> = {
    [keyId(w.keys["gov-id"])]: ACCOUNT["gov-id"], [keyId(w.keys["uni-x"])]: ACCOUNT["uni-x"],
    [keyId(w.keys["uni-y"])]: ACCOUNT["uni-y"], [keyId(w.keys["med-board"])]: ACCOUNT["med-board"],
  };
  let posted = 0; // how many of w.anchors are already on the chain
  /** Mirrors every issuance-log anchor created so far onto the chain, in order, at its (simulated) time. */
  async function syncChain() {
    if (!chain.online) return;
    while (posted < w.anchors.length) {
      const a = w.anchors[posted];
      const acct = anchorer[a.issuerKeyId];
      if (acct === undefined) throw new Error("no anchoring account for key " + a.issuerKeyId);
      await chain.anchor(a, acct, a.anchoredAt);
      posted++;
    }
  }

  const st = {
    chain, syncChain,
    w, phase: "normal" as Phase, registry: w.registry as SignedRegistry, history: [w.registry] as SignedRegistry[],
    pinned: w.registry as SignedRegistry | undefined,
    revoked: {} as Record<string, number[]>, extraKeys: [] as { issuerId: string; key: any }[],
    epoch2: undefined as undefined | ReturnType<typeof w.c.keyFromSeed>, epoch2Log: new IssuanceLog(w.c, DEPTH),
    outage: false, nonces: new NonceStore(5 * 60_000), requests: new Map<string, WireRequest>(),
    wallets: { alice, mallory } as Record<string, Wallet>, log, event, counter: 100, audit: [] as any[],
    lists() { return st.outage ? new Map() : w.lists(st.revoked, st.extraKeys); },
    nextStatusIndex() { return BigInt(st.counter++); },
    lastIssueMs: 0,
    /** Simulated time for a new issuance. Strictly increasing, so the chain (which never goes backwards) always agrees. */
    issueClock() {
      const base = Date.parse(st.phase === "normal" ? "2026-10-02T09:00:00.000Z" : st.phase === "stolen" ? T_FRAUD : "2026-10-25T11:30:00.000Z");
      st.lastIssueMs = Math.max(base, st.lastIssueMs + 60_000);
      return new Date(st.lastIssueMs).toISOString();
    },

    async steal() {
      if (st.phase !== "normal") throw new Error("key already stolen/declared");
      const fraud = w.fraudDegree(mallorySecret, 29n);
      const anchor = w.anchors[w.anchors.length - 1];
      mallory.creds.push(credToWire("degree", "B.Sc. Computer Science, Northfield University (issued with STOLEN key)", "uni-x", BigInt(anchor.root), fraud));
      st.phase = "stolen";
      await syncChain();
      event("attacker", `attacker used the stolen uni-x signing key and its anchoring account to issue a fake degree; the chain stamped the anchor at block time ${anchor.anchoredAt} (inside the compromise window; it cannot be backdated)`);
    },
    async declare() {
      if (st.phase === "declared") throw new Error("already declared");
      const old = st.registry.body.issuers.find((i) => i.issuerId === "uni-x")!.keys[0];
      const e2 = w.c.keyFromSeed("uni-x-epoch2");
      st.epoch2 = e2; st.extraKeys.push({ issuerId: "uni-x", key: e2 });
      st.registry = declareCompromise(st.registry, {
        issuerId: "uni-x", keyId: old.keyId, windowStart: WINDOW_START, windowEnd: WINDOW_END, reason: "issuance-key theft (simulated)",
        replacementKey: { keyId: keyId(e2), pub: { Ax: e2.pub.Ax.toString(), Ay: e2.pub.Ay.toString() }, epoch: 2, status: "active" },
      }, w.admin.priv, T_DECLARED);
      st.history.push(st.registry); st.phase = "declared";
      anchorer[keyId(e2)] = ACCOUNT["uni-x"]; // the replacement key is anchored by the same university service account
      if (chain.online) { await chain.publishRegistry(st.registry, T_DECLARED); await chain.authorise(keyId(e2), ACCOUNT["uni-x"], T_DECLARED); }
      event("registry", `trust registry v${st.registry.body.version} published: uni-x key epoch 1 COMPROMISED (window ${WINDOW_START} to ${WINDOW_END}); epoch 2 key activated; version hash recorded on the chain`);
    },
    async reissue(profile: string) {
      if (st.phase !== "declared" || !st.epoch2) throw new Error("declare the compromise first");
      const wal = st.wallets[profile]; if (!wal) throw new Error("unknown profile");
      const i = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, st.nextStatusIndex(), 5000n + BigInt(st.counter), { key: st.epoch2, log: st.epoch2Log, secret: BigInt(wal.holderSecret) });
      const anchor = w.anchorLog(st.epoch2, st.epoch2Log, st.issueClock());
      const sc = w.present(i, anchor);
      wal.creds.push(credToWire("degree", "B.Sc. Computer Science, Northfield University (re-issued, key epoch 2)", "uni-x", BigInt(anchor.root), sc));
      await syncChain();
      event("issuer", "uni-x re-attested a degree under replacement key epoch 2 (anchored on the chain)");
    },
    revokeLicense(profile: string) {
      const lic = st.wallets[profile]?.creds.find((c) => c.role === "license"); if (!lic) throw new Error("no license");
      (st.revoked["med-board"] ??= []).push(Number(lic.fields.statusIndex));
      event("issuer", "med-board published a new signed status list (one slot revoked; no identity published)");
    },
    summary(anchors: import("../core/notary").Anchor[]) {
      const old = st.registry.body.issuers.find((i) => i.issuerId === "uni-x")!.keys[0];
      return old.compromise ? incidentSummary(old.keyId, old.compromise, anchors, w.notary.pub) : undefined;
    },
  };
  if (chain.online) {
    await chain.reset(); // clean dev chain + fresh contract, then replay the demo timeline onto it
    await chain.publishRegistry(w.registry, T_REGISTRY);
    for (const [k, acct] of Object.entries(anchorer)) await chain.authorise(k, acct, T_REGISTRY);
    await syncChain();
    event("chain", `local chain online: contract ${chain.address.slice(0, 10)}…, registry v1 and ${posted} issuance-log anchors recorded`);
  } else event("chain", "chain unreachable: verifiers will fail closed until it is back (start it with: npm run chain, then Reset demo)");
  event("system", "demo world initialised: 4 issuers, registry v1");
  return st;
}
export type State = Awaited<ReturnType<typeof createState>>;
