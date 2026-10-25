import type { CredentialFields, Signature, PublicKey } from "./crypto";
import type { MerklePath } from "./merkle";

export interface SignedCredential {
  fields: CredentialFields;
  sig: Signature;
  issuerPub: PublicKey;
  merkle: MerklePath; // inclusion path in the issuer's notarized issuance log
}

export interface ProofRequest {
  ageCutoff: bigint; // dob must be <= this (YYYYMMDD)
  requiredDegree: bigint;
  requiredLicense: bigint;
  today: bigint; // license expiry must be >= this
  nonce: bigint; // verifier challenge
}

export const PUBLIC_SIGNAL_NAMES = [
  "idKeyId", "degKeyId", "licKeyId", "idStatus", "degStatus", "licStatus", "idRoot", "degRoot", "licRoot",
  "ageCutoff", "requiredDegree", "requiredLicense", "today", "nonce",
] as const;

export interface ZkProof { proof: any; publicSignals: string[] }

export function buildInput(holderSecret: bigint, id: SignedCredential, deg: SignedCredential, lic: SignedCredential, req: ProofRequest) {
  const s = (x: bigint) => x.toString();
  return {
    ageCutoff: s(req.ageCutoff), requiredDegree: s(req.requiredDegree), requiredLicense: s(req.requiredLicense),
    today: s(req.today), nonce: s(req.nonce), holderSecret: s(holderSecret),
    dob: s(id.fields.a1), idSalt: s(id.fields.salt), idStatus: s(id.fields.statusIndex),
    idAx: s(id.issuerPub.Ax), idAy: s(id.issuerPub.Ay), idR8x: s(id.sig.R8x), idR8y: s(id.sig.R8y), idS: s(id.sig.S),
    degCode: s(deg.fields.a1), degDate: s(deg.fields.a2), degSalt: s(deg.fields.salt), degStatus: s(deg.fields.statusIndex),
    degAx: s(deg.issuerPub.Ax), degAy: s(deg.issuerPub.Ay), degR8x: s(deg.sig.R8x), degR8y: s(deg.sig.R8y), degS: s(deg.sig.S),
    licType: s(lic.fields.a1), licExpiry: s(lic.fields.a2), licSalt: s(lic.fields.salt), licStatus: s(lic.fields.statusIndex),
    idSib: id.merkle.siblings.map(s), idIdx: id.merkle.indices.map(String),
    degSib: deg.merkle.siblings.map(s), degIdx: deg.merkle.indices.map(String),
    licSib: lic.merkle.siblings.map(s), licIdx: lic.merkle.indices.map(String),
    licAx: s(lic.issuerPub.Ax), licAy: s(lic.issuerPub.Ay), licR8x: s(lic.sig.R8x), licR8y: s(lic.sig.R8y), licS: s(lic.sig.S),
  };
}


export function namedSignals(p: ZkProof): Record<(typeof PUBLIC_SIGNAL_NAMES)[number], bigint> {
  return Object.fromEntries(PUBLIC_SIGNAL_NAMES.map((n, i) => [n, BigInt(p.publicSignals[i])])) as any;
}
