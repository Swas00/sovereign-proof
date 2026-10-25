import { createHash } from "node:crypto";
import type { Crypto, PublicKey, Signature } from "./crypto";
import { canonical } from "./registry";

/**
 * Bitstring status list (W3C Bitstring Status List style), one per issuer key.
 * Bit i = 1 means the credential with statusIndex i is revoked.
 * Verifiers download the WHOLE list, so the issuer never learns which credential was checked.
 */
export interface StatusList {
  issuerKeyId: string;
  version: number;
  issuedAt: string;
  size: number;
  bits: string; // base64
  sig: { R8x: string; R8y: string; S: string };
}

const body = (l: Omit<StatusList, "sig">) => ({ issuerKeyId: l.issuerKeyId, version: l.version, issuedAt: l.issuedAt, size: l.size, bits: l.bits });
// Reduce sha256 to a 248-bit value so it is always a valid BN254 field element.
const msgOf = (l: Omit<StatusList, "sig">) => BigInt("0x" + createHash("sha256").update(canonical(body(l))).digest("hex").slice(0, 62));

export function buildStatusList(c: Crypto, prv: Uint8Array, issuerKeyId: string, version: number, size: number, revoked: number[], issuedAt: string): StatusList {
  const bytes = Buffer.alloc(Math.ceil(size / 8));
  for (const i of revoked) bytes[i >> 3] |= 1 << (i & 7);
  const base = { issuerKeyId, version, issuedAt, size, bits: bytes.toString("base64") };
  const s: Signature = c.sign(prv, msgOf(base));
  return { ...base, sig: { R8x: s.R8x.toString(), R8y: s.R8y.toString(), S: s.S.toString() } };
}

export function verifyStatusList(c: Crypto, l: StatusList, pub: PublicKey): boolean {
  return c.verify(msgOf(l), { R8x: BigInt(l.sig.R8x), R8y: BigInt(l.sig.R8y), S: BigInt(l.sig.S) }, pub);
}

export function isRevoked(l: StatusList, index: number): boolean {
  if (index < 0 || index >= l.size) throw new RangeError("status index outside list");
  return ((Buffer.from(l.bits, "base64")[index >> 3] >> (index & 7)) & 1) === 1;
}
