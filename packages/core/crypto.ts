import { buildEddsa, buildPoseidon } from "circomlibjs";
import { createHash } from "node:crypto";

// Credential field layout. One generic 6-field shape signed with EdDSA-Poseidon:
//   msg = Poseidon(type, holderId, a1, a2, statusIndex, salt)
// ID card:  a1 = dob (YYYYMMDD),        a2 = identityBinding(name, address)
// Degree:   a1 = degreeCode,            a2 = graduation date (YYYYMMDD)
// License:  a1 = licenseTypeCode,       a2 = expiry date (YYYYMMDD)
export const CRED_TYPE = { ID: 1n, DEGREE: 2n, LICENSE: 3n } as const;

export interface CredentialFields {
  type: bigint;
  holderId: bigint; // Poseidon(holderSecret): same value in every credential of one holder
  a1: bigint;
  a2: bigint;
  statusIndex: bigint; // position in the issuer's status list
  salt: bigint; // blinds the commitment against guessing
}

export interface Signature {
  R8x: bigint;
  R8y: bigint;
  S: bigint;
}

export interface PublicKey {
  Ax: bigint;
  Ay: bigint;
}

export interface Crypto {
  hash(inputs: bigint[]): bigint;
  holderId(holderSecret: bigint): bigint;
  commitment(f: CredentialFields): bigint;
  keyFromSeed(seed: string): { prv: Uint8Array; pub: PublicKey };
  identityBinding(name: string, address: string): bigint; // Poseidon(H(name), H(address)); goes in the ID credential's a2
  keyId(pub: PublicKey): bigint; // Poseidon(Ax, Ay): the public handle used in the registry and circuit
  sign(prv: Uint8Array, msg: bigint): Signature;
  verify(msg: bigint, sig: Signature, pub: PublicKey): boolean;
}

export async function buildCrypto(): Promise<Crypto> {
  const poseidon = await buildPoseidon();
  const eddsa = await buildEddsa();
  const F = eddsa.F;
  const toBig = (x: any): bigint => BigInt(F.toString(x));
  const hash = (inputs: bigint[]): bigint => toBig(poseidon(inputs));

  return {
    hash,
    holderId: (secret) => hash([secret]),
    commitment: (f) => hash([f.type, f.holderId, f.a1, f.a2, f.statusIndex, f.salt]),
    // Deterministic seed -> private key. Only for seeded demo issuers; real keys come from a CSPRNG/HSM.
    keyFromSeed(seed) {
      const prv = createHash("sha256").update(seed).digest();
      const [x, y] = eddsa.prv2pub(prv);
      return { prv, pub: { Ax: toBig(x), Ay: toBig(y) } };
    },
    identityBinding(name, address) {
      // 248-bit digests are valid field elements; the pair is hashed so the ID commits to both without exposing either.
      const f = (s: string) => BigInt("0x" + createHash("sha256").update(s.normalize("NFC")).digest("hex").slice(0, 62));
      return hash([f(name), f(address)]);
    },
    keyId: (pub) => hash([pub.Ax, pub.Ay]),
    sign(prv, msg) {
      const s = eddsa.signPoseidon(prv, F.e(msg));
      return { R8x: toBig(s.R8[0]), R8y: toBig(s.R8[1]), S: BigInt(s.S) };
    },
    verify(msg, sig, pub) {
      return eddsa.verifyPoseidon(
        F.e(msg),
        { R8: [F.e(sig.R8x), F.e(sig.R8y)], S: sig.S },
        [F.e(pub.Ax), F.e(pub.Ay)],
      );
    },
  };
}
