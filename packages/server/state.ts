import { CRED_TYPE } from "../core/crypto";
import { ACCOUNT, type Chain } from "./chain";
import { buildWorld, CODES, PEOPLE, DEPTH, SIZE, T_DECLARED, T_FRAUD, T_REGISTRY, WINDOW_END, WINDOW_START } from "../core/fixtures";
import { IssuanceLog, rootFromPath } from "../core/merkle";
import { declareCompromise, incidentSummary } from "../core/incident";
import { NonceStore } from "../core/verify";
import { credToWire, type WireCred, type WireRequest } from "../core/wire";
import { canonical, sha256hex, type SignedRegistry } from "../core/registry";
import { buildStatusList, type StatusList } from "../core/status";
import { diffJson, diffStatus, type Change } from "../core/diff";
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

  // Status lists: versioned, archived as published, and recorded on the chain. `served` is what the status service hands out
  // (the demo can tamper with it); the archive keeps each version exactly as the issuer published it.
  const statusVersion: Record<string, number> = {};
  const served = new Map<string, StatusList>();
  const listArchive = new Map<string, StatusList>();
  const issuerOfKey: Record<string, string> = {};
  async function publishList(issuerId: string, key: { prv: Uint8Array; pub: any }, atIso: string, note: string) {
    const kid = keyId(key), version = (statusVersion[kid] ?? 0) + 1;
    const l = buildStatusList(w.c, key.prv, kid, version, SIZE, st.revoked[issuerId] ?? [], atIso);
    statusVersion[kid] = version; issuerOfKey[kid] = issuerId; served.set(kid, l); listArchive.set(`${kid}:${version}`, l);
    if (chain.online) await chain.publishStatus(kid, version, sha256hex(canonical(l)), note, anchorer[kid], atIso);
  }

  const st = {
    chain, syncChain,
    w, phase: "normal" as Phase, registry: w.registry as SignedRegistry, history: [w.registry] as SignedRegistry[],
    pinned: w.registry as SignedRegistry | undefined,
    revoked: {} as Record<string, number[]>, extraKeys: [] as { issuerId: string; key: any }[],
    epoch2: undefined as undefined | ReturnType<typeof w.c.keyFromSeed>, epoch2Log: new IssuanceLog(w.c, DEPTH),
    outage: false, nonces: new NonceStore(5 * 60_000), requests: new Map<string, WireRequest>(),
    wallets: { alice, mallory } as Record<string, Wallet>, log, event, counter: 100, audit: [] as any[],
    lists() { return st.outage ? new Map<string, StatusList>() : new Map(served); },
    served, listArchive, statusVersion, issuerOfKey,
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
    /** An outsider tries to change the registry, forge an anchor and publish a status list. The contract records each attempt. */
    async attemptUnauthorised() {
      if (!chain.online) throw new Error("chain unreachable");
      const res = await chain.attemptUnauthorised(st.issueClock(), { keyId: keyId(w.keys["uni-x"]), registryVersion: st.registry.body.version + 1, registryPrevHash: st.history[st.history.length - 1].hash });
      event("attacker", `an unknown account tried to rewrite the registry, anchor a root and publish a status list: ${res.filter((r) => r.rejected).length} of ${res.length} refused, and each attempt is recorded on the chain with the account and time`);
    },
    /** Demo: someone edits the STORED registry outside the contract (no admin signature, no chain record). */
    tamperRegistry() {
      const copy: SignedRegistry = JSON.parse(JSON.stringify(st.registry));
      const bad = copy.body.issuers.flatMap((i) => i.keys.map((k) => ({ i, k }))).find((x) => x.k.status === "compromised");
      if (bad) { bad.k.status = "active"; delete (bad.k as any).compromise; }
      else copy.body.issuers.push({ issuerId: "evil-university", name: "Evil University", credTypes: [2], keys: [{ keyId: keyId(w.attacker), pub: { Ax: w.attacker.pub.Ax.toString(), Ay: w.attacker.pub.Ay.toString() }, epoch: 1, status: "active" }] });
      st.registry = copy; // the pristine versions stay in st.history (the verified archive)
      event("tamper", bad ? "someone edited the stored registry so the compromised key reads 'active' (no admin signature, no chain record)" : "someone injected 'Evil University' into the stored registry (no admin signature, no chain record)");
    },
    /** Demo: replay an OLDER, validly signed status list so a revoked credential looks valid again. */
    rollbackStatus() {
      const kid = keyId(w.keys["med-board"]), v = statusVersion[kid] ?? 1;
      const older = listArchive.get(`${kid}:${v - 1}`);
      if (!older) throw new Error("revoke a license first: there is no earlier status list to roll back to");
      served.set(kid, older);
      event("tamper", `someone replaced the served med-board status list v${v} with the older signed v${v - 1}, un-revoking a credential (the signature is still valid)`);
    },
    /** Put the served data back from the verified archive. */
    restore() {
      st.registry = st.history[st.history.length - 1];
      for (const [kid, v] of Object.entries(statusVersion)) { const l = listArchive.get(`${kid}:${v}`); if (l) served.set(kid, l); }
      event("restore", "stored registry and status lists restored from the verified archive");
    },
    /** Compare what is served with what the chain recorded, and explain every difference. */
    async integrity() {
      const snap = await chain.snapshot();
      if (!snap.ok) return { ok: false as const, error: snap.error ?? "chain unreachable", findings: [] };
      type Finding = { subject: string; ok: boolean; summary: string; chain?: any; changes?: Change[]; previous?: string };
      const findings: Finding[] = [];
      const meta = (r: { publisherLabel: string; time: string; blockNumber?: number; txHash?: string; hash: string }) => ({ by: r.publisherLabel, at: r.time, block: r.blockNumber, tx: r.txHash, hash: r.hash });
      // registry as currently served
      const v = st.registry.body.version, rec = snap.registry.find((r) => r.version === v), latest = snap.registry[snap.registry.length - 1];
      const servedHash = sha256hex(canonical(st.registry.body));
      if (!rec) findings.push({ subject: `Trust registry v${v}`, ok: false, summary: "this version was never recorded on the chain" });
      else if (rec.hash !== servedHash) {
        const orig = st.history.find((h) => h.body.version === v), prev = snap.registry.find((r) => r.version === v - 1);
        const prevOk = prev && st.history.find((h) => h.body.version === v - 1) && sha256hex(canonical(st.history.find((h) => h.body.version === v - 1)!.body)) === prev.hash;
        findings.push({ subject: `Trust registry v${v}`, ok: false, summary: "the served registry does NOT match what the registry admin recorded on the chain: it was changed after publication",
          chain: meta(rec), changes: orig && sha256hex(canonical(orig.body)) === rec.hash ? diffJson(orig.body, st.registry.body) : undefined,
          previous: prev ? `previous record v${prev.version} (${prev.hash.slice(0, 10)}…) ${prevOk ? "verified against the archive" : "recorded"} at ${prev.time}` : undefined });
      } else if (latest && latest.version !== v) findings.push({ subject: `Trust registry v${v}`, ok: false, summary: `stale: the chain is at v${latest.version}`, chain: meta(rec) });
      else findings.push({ subject: `Trust registry v${v}`, ok: true, summary: `matches the record published by ${rec.publisherLabel}`, chain: meta(rec) });
      // archive integrity (the source of every "previous value")
      for (const r of snap.registry) { const h = st.history.find((x) => x.body.version === r.version); if (!h || sha256hex(canonical(h.body)) !== r.hash) findings.push({ subject: `Archived registry v${r.version}`, ok: false, summary: "archive copy does not match the chain record" }); }
      // status lists as currently served
      for (const [kid, list] of served) {
        const recs = snap.status[kid] ?? [], last = recs[recs.length - 1], name = `Status list · ${issuerOfKey[kid] ?? kid.slice(0, 8)}`;
        if (!last) { findings.push({ subject: name, ok: false, summary: "no record on the chain" }); continue; }
        const h = sha256hex(canonical(list));
        if (list.version !== last.version) {
          const pristine = listArchive.get(`${kid}:${last.version}`);
          findings.push({ subject: name, ok: false, summary: `rolled back: v${list.version} is being served but the issuer published v${last.version}`, chain: meta(last), changes: pristine ? diffStatus(pristine, list) : undefined, previous: `the replayed list v${list.version} is genuine and validly signed, which is why only the chain can expose it` });
        } else if (h !== last.hash) findings.push({ subject: name, ok: false, summary: "the served list differs from the version the issuer recorded: it was altered", chain: meta(last) });
        else findings.push({ subject: name, ok: true, summary: `v${list.version} matches the record published by ${last.publisherLabel}`, chain: meta(last) });
      }
      return { ok: true as const, checkedAt: new Date().toISOString(), findings, clean: findings.every((f) => f.ok) };
    },
    /** Chain audit feed + readable "what changed", shown only when the archived copy re-hashes to the chain's record. */
    enrichAudit(audit: import("./chain").AuditEntry[]) {
      const label = (kid?: string) => (kid ? (issuerOfKey[kid] ? `${issuerOfKey[kid]} key` : `key ${kid.slice(0, 8)}…`) : undefined);
      return audit.map((e) => {
        let changes: Change[] | undefined;
        const vReg = /^Registry v(\d+)/.exec(e.action), vSt = /^Status list v(\d+)/.exec(e.action);
        if (vReg && Number(vReg[1]) > 1) {
          const a = st.history.find((h) => h.body.version === Number(vReg[1]) - 1), b = st.history.find((h) => h.body.version === Number(vReg[1]));
          if (a && b && sha256hex(canonical(a.body)) === e.previous && sha256hex(canonical(b.body)) === e.next) changes = diffJson(a.body, b.body).filter((c) => !/^(version|prevHash|issuedAt|note)$/.test(c.path));
        } else if (vSt && e.target && Number(vSt[1]) > 1) {
          const a = listArchive.get(`${e.target}:${Number(vSt[1]) - 1}`), b = listArchive.get(`${e.target}:${vSt[1]}`);
          if (a && b && sha256hex(canonical(a)) === e.previous && sha256hex(canonical(b)) === e.next) changes = diffStatus(a, b);
        }
        return { ...e, targetLabel: label(e.target), changes };
      });
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
      if (chain.online) {
        await chain.publishRegistry(st.registry, T_DECLARED, `uni-x key epoch 1 declared compromised (window ${WINDOW_START} to ${WINDOW_END}); epoch 2 key activated`);
        await chain.authorise(keyId(e2), ACCOUNT["uni-x"], T_DECLARED);
      }
      await publishList("uni-x", e2, T_DECLARED, "status list for the replacement key (epoch 2)");
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
    async revokeLicense(profile: string) {
      const lic = st.wallets[profile]?.creds.find((c) => c.role === "license"); if (!lic) throw new Error("no license");
      (st.revoked["med-board"] ??= []).push(Number(lic.fields.statusIndex));
      await publishList("med-board", w.keys["med-board"], st.issueClock(), `slot #${lic.fields.statusIndex} revoked (the slot number is public; no holder is named)`);
      event("issuer", "med-board published a new signed status list (one slot revoked; no identity published)");
    },
    summary(anchors: import("../core/notary").Anchor[]) {
      const old = st.registry.body.issuers.find((i) => i.issuerId === "uni-x")!.keys[0];
      return old.compromise ? incidentSummary(old.keyId, old.compromise, anchors, w.notary.pub) : undefined;
    },
  };
  if (chain.online) {
    await chain.reset(); // clean dev chain + fresh contract, then replay the demo timeline onto it
    await chain.publishRegistry(w.registry, T_REGISTRY, "initial trust registry: 4 issuers, one key each");
    for (const [k, acct] of Object.entries(anchorer)) await chain.authorise(k, acct, T_REGISTRY);
    await syncChain();
    event("chain", `local chain online: contract ${chain.address.slice(0, 10)}…, registry v1 and ${posted} issuance-log anchors recorded`);
  } else event("chain", "chain unreachable: verifiers will fail closed until it is back (start it with: npm run chain, then Reset demo)");
  for (const id of ["gov-id", "uni-x", "uni-y", "med-board"]) await publishList(id, w.keys[id], "2026-10-01T09:10:00.000Z", "initial status list (no revocations)");
  event("system", "demo world initialised: 4 issuers, registry v1, status lists v1");
  return st;
}
export type State = Awaited<ReturnType<typeof createState>>;
