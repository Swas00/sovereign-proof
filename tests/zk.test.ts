import { describe, it, expect, beforeAll } from "vitest";
import { buildCrypto, CRED_TYPE, type Crypto } from "../packages/core/crypto";
import { buildInput, prove, verifyProof, namedSignals, type SignedCredential, type ProofRequest } from "../packages/core/prover";

let c: Crypto;
const secret = 987654321n;
const issue = (seed: string, type: bigint, a1: bigint, a2: bigint, idx: bigint, salt: bigint, holder = secret): SignedCredential => {
  const k = c.keyFromSeed(seed);
  const fields = { type, holderId: c.holderId(holder), a1, a2, statusIndex: idx, salt };
  return { fields, sig: c.sign(k.prv, c.commitment(fields)), issuerPub: k.pub };
};
const DEGREE_CS = 555n, MEDICAL = 77n;
const req: ProofRequest = { ageCutoff: 20050101n, requiredDegree: DEGREE_CS, requiredLicense: MEDICAL, today: 20261025n, nonce: 424242n };

let id: SignedCredential, deg: SignedCredential, lic: SignedCredential;
beforeAll(async () => {
  c = await buildCrypto();
  id = issue("gov", CRED_TYPE.ID, 19950315n, 0n, 1n, 11n);
  deg = issue("uni", CRED_TYPE.DEGREE, DEGREE_CS, 20180601n, 2n, 22n);
  lic = issue("board", CRED_TYPE.LICENSE, MEDICAL, 20300101n, 3n, 33n);
});

describe("compound ZK proof", () => {
  it("proves degree + age>21 + active license, verifies, and leaks no private data", async () => {
    const t0 = performance.now();
    const p = await prove(buildInput(secret, id, deg, lic, req));
    const ms = performance.now() - t0;
    console.log(`proof generated in ${Math.round(ms)} ms (node, measured)`);
    expect(await verifyProof(p)).toBe(true);
    const s = namedSignals(p);
    expect(s.degKeyId).toBe(c.keyId(deg.issuerPub));
    expect(s.nonce).toBe(req.nonce);
    const blob = JSON.stringify(p);
    for (const secretVal of ["19950315", "20300101", "20180601", secret.toString()]) expect(blob).not.toContain(secretVal);
  }, 120000);

  it("verification fails if a public input (the nonce) is swapped", async () => {
    const p = await prove(buildInput(secret, id, deg, lic, req));
    const bad = { ...p, publicSignals: [...p.publicSignals] };
    bad.publicSignals[10] = "1";
    expect(await verifyProof(bad)).toBe(false);
  }, 120000);

  it("cannot prove age>21 for someone under 21", async () => {
    const young = issue("gov", CRED_TYPE.ID, 20100315n, 0n, 1n, 11n);
    await expect(prove(buildInput(secret, young, deg, lic, req))).rejects.toThrow();
  }, 120000);

  it("cannot prove with an expired license", async () => {
    const expired = issue("board", CRED_TYPE.LICENSE, MEDICAL, 20240101n, 3n, 33n);
    await expect(prove(buildInput(secret, id, deg, expired, req))).rejects.toThrow();
  }, 120000);

  it("cannot prove the wrong degree", async () => {
    await expect(prove(buildInput(secret, id, deg, lic, { ...req, requiredDegree: 999n }))).rejects.toThrow();
  }, 120000);

  it("cannot mix credentials belonging to different holders", async () => {
    const other = issue("uni", CRED_TYPE.DEGREE, DEGREE_CS, 20180601n, 2n, 22n, 111n);
    await expect(prove(buildInput(secret, id, other, lic, req))).rejects.toThrow();
  }, 120000);

  it("cannot prove with a forged (self-signed) credential: proof builds but names the forger's key", async () => {
    const forged = issue("attacker", CRED_TYPE.DEGREE, DEGREE_CS, 20180601n, 2n, 22n);
    const p = await prove(buildInput(secret, id, forged, lic, req));
    expect(await verifyProof(p)).toBe(true); // math is valid...
    expect(namedSignals(p).degKeyId).toBe(c.keyId(c.keyFromSeed("attacker").pub)); // ...trust layer must reject this key
  }, 120000);
});
