import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import type { Crypto, CredentialFields, Signature, PublicKey } from "./crypto";

export interface SignedCredential {
  fields: CredentialFields;
  sig: Signature;
  issuerPub: PublicKey;
}

export interface ProofRequest {
  ageCutoff: bigint; // dob must be <= this (YYYYMMDD)
  requiredDegree: bigint;
  requiredLicense: bigint;
  today: bigint; // license expiry must be >= this
  nonce: bigint; // verifier challenge
}

export const PUBLIC_SIGNAL_NAMES = [
  "idKeyId", "degKeyId", "licKeyId", "idStatus", "degStatus", "licStatus",
  "ageCutoff", "requiredDegree", "requiredLicense", "today", "nonce",
] as const;

export interface ZkProof { proof: any; publicSignals: string[] }

export interface Artifacts { wasm: string; zkey: string; vkey: string }

export const DEFAULT_ARTIFACTS: Artifacts = {
  wasm: "circuits/build/compound_proof_js/compound_proof.wasm",
  zkey: "circuits/build/compound.zkey",
  vkey: "circuits/build/compound_vkey.json",
};

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
    licAx: s(lic.issuerPub.Ax), licAy: s(lic.issuerPub.Ay), licR8x: s(lic.sig.R8x), licR8y: s(lic.sig.R8y), licS: s(lic.sig.S),
  };
}

/** Generates the compound proof. Throws if any predicate or signature is false (the witness cannot be built). */
export async function prove(input: Record<string, string>, a: Artifacts = DEFAULT_ARTIFACTS): Promise<ZkProof> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, a.wasm, a.zkey);
  return { proof, publicSignals };
}

export async function verifyProof(p: ZkProof, a: Artifacts = DEFAULT_ARTIFACTS): Promise<boolean> {
  const vkey = JSON.parse(readFileSync(a.vkey, "utf8"));
  return snarkjs.groth16.verify(vkey, p.publicSignals, p.proof);
}

export function namedSignals(p: ZkProof): Record<(typeof PUBLIC_SIGNAL_NAMES)[number], bigint> {
  return Object.fromEntries(PUBLIC_SIGNAL_NAMES.map((n, i) => [n, BigInt(p.publicSignals[i])])) as any;
}
