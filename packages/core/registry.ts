import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export type KeyStatus = "active" | "revoked" | "compromised";

export interface CompromiseRecord {
  windowStart: string; // ISO: earliest time the key may have been controlled by an attacker
  windowEnd: string; // ISO: when the key was revoked/rotated
  reason: string;
  anchorRoot?: string; // notarized issuance-log root from BEFORE windowStart (legacy evidence)
  anchorTime?: string;
}

export interface IssuerKey {
  keyId: string; // decimal string of Poseidon(Ax, Ay); the handle that appears in proofs
  pub: { Ax: string; Ay: string };
  epoch: number;
  status: KeyStatus;
  compromise?: CompromiseRecord;
}

export interface IssuerEntry {
  issuerId: string;
  name: string;
  credTypes: number[]; // which credential types this issuer is authorized to issue (1 ID, 2 DEGREE, 3 LICENSE)
  keys: IssuerKey[];
}

export interface RegistryBody {
  version: number;
  prevHash: string; // hash of the previous version -> hash chain, makes silent history rewrites detectable
  issuedAt: string;
  issuers: IssuerEntry[];
  note?: string;
}

export interface SignedRegistry { body: RegistryBody; hash: string; sig: string }

/** Deterministic JSON: sorted keys, so signatures and hashes are reproducible. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
/** Deterministic Ed25519 admin key from a seed (demo only; a real registry admin key lives in an HSM / multisig). */
export function adminKeyFromSeed(seed: string): { priv: KeyObject; pub: KeyObject } {
  const raw = createHash("sha256").update(seed).digest();
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, raw]), format: "der", type: "pkcs8" });
  return { priv, pub: createPublicKey(priv) };
}

export function signRegistry(body: RegistryBody, adminPriv: KeyObject): SignedRegistry {
  const hash = sha256hex(canonical(body));
  return { body, hash, sig: sign(null, Buffer.from(hash, "hex"), adminPriv).toString("base64") };
}

export const GENESIS_HASH = "0".repeat(64);

/** Publish the next version by applying `mutate` to a deep copy of the previous body. */
export function publishNext(prev: SignedRegistry | null, mutate: (b: RegistryBody) => void, adminPriv: KeyObject, issuedAt: string): SignedRegistry {
  const body: RegistryBody = prev
    ? JSON.parse(JSON.stringify(prev.body))
    : { version: 0, prevHash: GENESIS_HASH, issuedAt, issuers: [] };
  mutate(body);
  body.version = (prev?.body.version ?? 0) + 1;
  body.prevHash = prev?.hash ?? GENESIS_HASH;
  body.issuedAt = issuedAt;
  return signRegistry(body, adminPriv);
}

export type RegistryCheck = { ok: true } | { ok: false; reason: string };

/**
 * Accept an incoming registry given the version this verifier has already pinned.
 * Defends against: forged edits (signature), tampered bodies (hash), rollback (version), forks (hash chain).
 */
export function acceptRegistry(incoming: SignedRegistry, adminPub: KeyObject, pinned?: SignedRegistry): RegistryCheck {
  if (sha256hex(canonical(incoming.body)) !== incoming.hash) return { ok: false, reason: "registry body does not match its hash (tampered)" };
  if (!verify(null, Buffer.from(incoming.hash, "hex"), adminPub, Buffer.from(incoming.sig, "base64")))
    return { ok: false, reason: "registry signature invalid: not signed by the registry admin key" };
  if (pinned) {
    if (incoming.body.version < pinned.body.version) return { ok: false, reason: `rollback: v${incoming.body.version} is older than pinned v${pinned.body.version}` };
    if (incoming.body.version === pinned.body.version && incoming.hash !== pinned.hash) return { ok: false, reason: "fork: same version, different content" };
    if (incoming.body.version === pinned.body.version + 1 && incoming.body.prevHash !== pinned.hash) return { ok: false, reason: "hash chain broken: does not extend the pinned version" };
  }
  return { ok: true };
}

export function findKey(reg: SignedRegistry, keyId: string): { issuer: IssuerEntry; key: IssuerKey } | undefined {
  for (const issuer of reg.body.issuers) for (const key of issuer.keys) if (key.keyId === keyId) return { issuer, key };
  return undefined;
}
