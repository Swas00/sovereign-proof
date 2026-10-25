import { randomBytes, createHash, type KeyObject } from "node:crypto";
import type { Crypto } from "./crypto";
import { verifyProof, namedSignals, type ZkProof, type ProofRequest } from "./prover";
import { acceptRegistry, findKey, type SignedRegistry } from "./registry";
import { evaluateEvidence } from "./incident";
import type { Anchor } from "./notary";
import { isRevoked, verifyStatusList, type StatusList } from "./status";

export type Outcome = "pass" | "fail" | "quarantine" | "warn";
export interface Step { id: string; label: string; outcome: Outcome; detail: string }
export interface VerificationResult {
  verdict: "accepted" | "rejected" | "quarantined";
  steps: Step[];
  disclosed: { issuers: { role: string; issuerId?: string; keyId: string }[]; policy: Record<string, string> };
  hidden: string[];
  auditId: string;
}

/** A verifier's compound request. `proof` fields are the public policy the circuit enforces. */
export interface VerifierRequest extends ProofRequest {
  requiredIssuers?: { id?: string; degree?: string; license?: string }; // pin issuer ids, e.g. degree must come from "uni-x"
  onStatusUnavailable: "reject" | "warn";
}

/** Single-use, expiring challenges: stops replay of a captured proof. */
export class NonceStore {
  private m = new Map<string, { exp: number; used: boolean }>();
  constructor(private ttlMs = 120_000) {}
  issue(now: number, nonce: bigint = BigInt("0x" + randomBytes(15).toString("hex"))): bigint {
    this.m.set(nonce.toString(), { exp: now + this.ttlMs, used: false });
    return nonce;
  }
  consume(nonce: bigint, now: number): "ok" | "unknown" | "expired" | "replayed" {
    const e = this.m.get(nonce.toString());
    if (!e) return "unknown";
    if (e.used) return "replayed";
    if (now > e.exp) return "expired";
    e.used = true;
    return "ok";
  }
}

export interface VerifierContext {
  crypto: Crypto;
  registry: SignedRegistry;
  pinnedRegistry?: SignedRegistry; // last version this verifier accepted (rollback protection)
  adminPub: KeyObject;
  anchors: Anchor[]; // notarized issuance-log roots (public)
  notaryPub: KeyObject;
  statusLists: Map<string, StatusList>; // by issuer keyId; absent = status service unavailable
  nonces: NonceStore;
  now: number;
}

const ROLES = [
  { role: "identity", type: 1, key: "idKeyId", status: "idStatus", root: "idRoot", pin: "id" },
  { role: "degree", type: 2, key: "degKeyId", status: "degStatus", root: "degRoot", pin: "degree" },
  { role: "license", type: 3, key: "licKeyId", status: "licStatus", root: "licRoot", pin: "license" },
] as const;

export async function verifyPresentation(p: ZkProof, req: VerifierRequest, ctx: VerifierContext): Promise<VerificationResult> {
  const steps: Step[] = [];
  const add = (id: string, label: string, outcome: Outcome, detail: string) => steps.push({ id, label, outcome, detail });
  const finish = (): VerificationResult => {
    const verdict = steps.some((s) => s.outcome === "fail") ? "rejected" : steps.some((s) => s.outcome === "quarantine") ? "quarantined" : "accepted";
    const sig = p.publicSignals.length >= 14 ? namedSignals(p) : undefined;
    return {
      verdict, steps,
      disclosed: {
        issuers: sig ? ROLES.map((r) => ({ role: r.role, keyId: String(sig[r.key]), issuerId: findKey(ctx.registry, String(sig[r.key]))?.issuer.issuerId })) : [],
        policy: { ageOver: "cutoff " + req.ageCutoff, degree: String(req.requiredDegree), license: String(req.requiredLicense) },
      },
      hidden: ["name", "date of birth", "home address", "graduation date", "license expiry", "holder secret", "credential contents"],
      // Audit id covers only public material, never witness data.
      auditId: createHash("sha256").update(JSON.stringify(p.publicSignals) + verdict).digest("hex").slice(0, 16),
    };
  };

  // 1. Registry integrity (signature, hash chain, no rollback)
  const rc = acceptRegistry(ctx.registry, ctx.adminPub, ctx.pinnedRegistry);
  add("registry", "Trust registry authentic and current", rc.ok ? "pass" : "fail", rc.ok ? `registry v${ctx.registry.body.version} signed by admin, extends pinned chain` : rc.reason);
  if (!rc.ok) return finish();

  // 2. Challenge freshness / replay
  const n = ctx.nonces.consume(req.nonce, ctx.now);
  add("nonce", "Fresh single-use challenge", n === "ok" ? "pass" : "fail", n === "ok" ? "nonce issued by this verifier, unexpired, first use" : `nonce ${n}`);
  if (n !== "ok") return finish();

  // 3. The proof must be about THIS request, not some weaker policy the holder picked
  if (p.publicSignals.length !== 14) { add("policy", "Proof answers this request", "fail", "unexpected public signal count"); return finish(); }
  const s = namedSignals(p);
  const same = s.ageCutoff === req.ageCutoff && s.requiredDegree === req.requiredDegree && s.requiredLicense === req.requiredLicense && s.today === req.today && s.nonce === req.nonce;
  add("policy", "Proof answers this request", same ? "pass" : "fail", same ? "age cutoff, degree, license, date and nonce match the verifier's request" : "proof was generated for a different policy or nonce");
  if (!same) return finish();

  // 4. Zero-knowledge proof
  const zk = await verifyProof(p).catch(() => false);
  add("zk", "Zero-knowledge proof valid", zk ? "pass" : "fail",
    zk ? "Groth16 proof verifies: 3 issuer signatures, one holder, age, degree, license-expiry predicates hold" : "proof does not verify");
  if (!zk) return finish();

  // 5. Issuer trust per credential (signature validity != trust)
  const trusted: Record<string, boolean> = {};
  for (const r of ROLES) {
    const keyId = String(s[r.key]);
    const hit = findKey(ctx.registry, keyId);
    const id = `trust-${r.role}`;
    const label = `Issuer trusted: ${r.role}`;
    trusted[r.role] = false;
    if (!hit) { add(id, label, "fail", `signing key ${keyId.slice(0, 10)}… is not in the trust registry (valid signature, untrusted issuer)`); continue; }
    if (!hit.issuer.credTypes.includes(r.type)) { add(id, label, "fail", `${hit.issuer.issuerId} is not authorized to issue ${r.role} credentials`); continue; }
    const pin = req.requiredIssuers?.[r.pin];
    if (pin && pin !== hit.issuer.issuerId) { add(id, label, "fail", `verifier requires ${pin}, credential was issued by ${hit.issuer.issuerId}`); continue; }
    if (hit.key.status === "revoked") { add(id, label, "fail", `${hit.issuer.issuerId} key (epoch ${hit.key.epoch}) was revoked`); continue; }
    // Issuance evidence: the credential's commitment must sit in a notarized issuance-log root for this key.
    const ev = evaluateEvidence(keyId, s[r.root], ctx.anchors, ctx.notaryPub, hit.key.status === "compromised" ? hit.key.compromise : undefined);
    if (hit.key.status === "compromised") {
      if (ev.decision === "preserved") {
        add(id, label, "pass", `${hit.issuer.issuerId} key epoch ${hit.key.epoch} is compromised, but legacy credential PRESERVED: ${ev.detail}`);
        trusted[r.role] = true;
      } else add(id, label, "quarantine", `${hit.issuer.issuerId} key epoch ${hit.key.epoch} is compromised; ${ev.decision === "unlogged" ? "no notarized issuance evidence" : "QUARANTINED"}: ${ev.detail}`);
      continue;
    }
    if (ev.decision === "unlogged") { add(id, label, "fail", `credential is not in any notarized issuance log of ${hit.issuer.issuerId}`); continue; }
    trusted[r.role] = true;
    add(id, label, "pass", `${hit.issuer.issuerId} (${hit.issuer.name}), key epoch ${hit.key.epoch}, active, issuance logged (${ev.detail})`);
  }

  // 6. Revocation via signed status list (only for keys we trust enough to look at)
  for (const r of ROLES) {
    if (!trusted[r.role]) continue;
    const keyId = String(s[r.key]);
    const hit = findKey(ctx.registry, keyId)!;
    const id = `status-${r.role}`;
    const label = `Not revoked: ${r.role}`;
    const list = ctx.statusLists.get(keyId);
    if (!list) {
      add(id, label, req.onStatusUnavailable === "warn" ? "warn" : "fail", `status list for ${hit.issuer.issuerId} unavailable; policy is ${req.onStatusUnavailable === "warn" ? "warn and continue" : "fail closed"}`);
      continue;
    }
    const lp = { Ax: BigInt(hit.key.pub.Ax), Ay: BigInt(hit.key.pub.Ay) };
    if (!verifyStatusList(ctx.crypto, list, lp)) { add(id, label, "fail", "status list signature invalid"); continue; }
    const idx = Number(s[r.status]);
    let rev: boolean;
    try { rev = isRevoked(list, idx); } catch { add(id, label, "fail", "status index outside the published list"); continue; }
    add(id, label, rev ? "fail" : "pass", rev ? `credential slot is marked revoked in list v${list.version}` : `slot not revoked in signed list v${list.version} (whole list fetched, issuer learns nothing about which slot)`);
  }
  return finish();
}
