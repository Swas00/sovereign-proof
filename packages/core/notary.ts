import { sign, verify, type KeyObject } from "node:crypto";
import { canonical, sha256hex } from "./registry";

/**
 * An independent witness timestamps issuance-log roots. Its key is NOT any issuer's key, so stealing a
 * university's signing key does not let an attacker forge or backdate an anchor.
 * (Simulated here by one Ed25519 key; in production: several independent witnesses / a transparency log.)
 */
export interface Anchor {
  issuerKeyId: string;
  root: string; // decimal
  leafCount: number;
  anchoredAt: string; // ISO, set by the NOTARY, never by the issuer
  sig: string;
}
const bodyOf = (a: Omit<Anchor, "sig">) => ({ issuerKeyId: a.issuerKeyId, root: a.root, leafCount: a.leafCount, anchoredAt: a.anchoredAt });

export function makeAnchor(issuerKeyId: string, root: bigint, leafCount: number, notaryPriv: KeyObject, at: string): Anchor {
  const base = { issuerKeyId, root: root.toString(), leafCount, anchoredAt: at };
  return { ...base, sig: sign(null, Buffer.from(sha256hex(canonical(bodyOf(base))), "hex"), notaryPriv).toString("base64") };
}
export function verifyAnchor(a: Anchor, notaryPub: KeyObject): boolean {
  return verify(null, Buffer.from(sha256hex(canonical(bodyOf(a))), "hex"), notaryPub, Buffer.from(a.sig, "base64"));
}
