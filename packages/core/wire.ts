import type { SignedCredential, ProofRequest } from "./proofinput";

/** JSON-safe credential as stored in the holder's wallet (bigints as decimal strings). */
export interface WireCred {
  role: "id" | "degree" | "license";
  label: string;
  issuerId: string;
  anchorRoot: string; // the notarized issuance-log root this credential's Merkle path leads to
  fields: { type: string; holderId: string; a1: string; a2: string; statusIndex: string; salt: string };
  sig: { R8x: string; R8y: string; S: string };
  issuerPub: { Ax: string; Ay: string };
  merkle: { siblings: string[]; indices: number[] };
  /** Attributes only the holder (and the issuer who wrote them) knows. They are bound into the signature but are never circuit inputs or proof outputs. */
  private?: { name?: string; address?: string };
}

export function credToWire(role: WireCred["role"], label: string, issuerId: string, anchorRoot: bigint, c: SignedCredential, priv?: WireCred["private"]): WireCred {
  const s = (x: bigint) => x.toString();
  return {
    role, label, issuerId, anchorRoot: s(anchorRoot),
    fields: { type: s(c.fields.type), holderId: s(c.fields.holderId), a1: s(c.fields.a1), a2: s(c.fields.a2), statusIndex: s(c.fields.statusIndex), salt: s(c.fields.salt) },
    sig: { R8x: s(c.sig.R8x), R8y: s(c.sig.R8y), S: s(c.sig.S) },
    issuerPub: { Ax: s(c.issuerPub.Ax), Ay: s(c.issuerPub.Ay) },
    merkle: { siblings: c.merkle.siblings.map(s), indices: c.merkle.indices },
    ...(priv ? { private: priv } : {}),
  };
}
export function credFromWire(w: WireCred): SignedCredential {
  const b = BigInt;
  return {
    fields: { type: b(w.fields.type), holderId: b(w.fields.holderId), a1: b(w.fields.a1), a2: b(w.fields.a2), statusIndex: b(w.fields.statusIndex), salt: b(w.fields.salt) },
    sig: { R8x: b(w.sig.R8x), R8y: b(w.sig.R8y), S: b(w.sig.S) },
    issuerPub: { Ax: b(w.issuerPub.Ax), Ay: b(w.issuerPub.Ay) },
    merkle: { siblings: w.merkle.siblings.map(b), indices: w.merkle.indices },
  };
}

export interface WireRequest {
  id: string; // = nonce, decimal
  ageCutoff: string; requiredDegree: string; requiredLicense: string; today: string; nonce: string;
  ageYears: number;
  requiredIssuers?: { id?: string; degree?: string; license?: string };
  onStatusUnavailable: "reject" | "warn";
  expiresAt: number;
}
export const reqToProof = (r: WireRequest): ProofRequest => ({
  ageCutoff: BigInt(r.ageCutoff), requiredDegree: BigInt(r.requiredDegree), requiredLicense: BigInt(r.requiredLicense), today: BigInt(r.today), nonce: BigInt(r.nonce),
});

export const CATALOG = {
  degrees: [{ code: "555", label: "B.Sc. Computer Science" }],
  licenses: [{ code: "77", label: "Medical license (MD)" }],
  today: "20261025",
};
