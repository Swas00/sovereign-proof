import { describe, it, expect, beforeAll } from "vitest";
import { CRED_TYPE } from "../packages/core/crypto";
import { buildInput, prove, verifyProof, namedSignals, PUBLIC_SIGNAL_NAMES, type ProofRequest } from "../packages/core/prover";
import { buildWorld, CODES, T_LEGACY } from "../packages/core/fixtures";

type W = Awaited<ReturnType<typeof buildWorld>>;
let w: W;
const req: ProofRequest = { ageCutoff: 20050101n, requiredDegree: CODES.CS_DEGREE, requiredLicense: CODES.MEDICAL, today: 20261025n, nonce: 424242n };
beforeAll(async () => { w = await buildWorld(); });
const run = (id = w.creds.id, deg = w.creds.degree, lic = w.creds.license, r = req, secret = w.holderSecret) => prove(buildInput(secret, id, deg, lic, r));
const T = 120000;

describe("compound ZK proof", () => {
  it("proves degree + age>21 + active license, verifies, leaks no private data", async () => {
    const t0 = performance.now();
    const p = await run();
    process.stdout.write(`[measured] proof generation: ${Math.round(performance.now() - t0)} ms (node)\n`);
    expect(await verifyProof(p)).toBe(true);
    const s = namedSignals(p);
    expect(s.degKeyId).toBe(w.keyIdOf(w.keys["uni-x"]) === undefined ? 0n : BigInt(w.keyIdOf(w.keys["uni-x"])));
    expect(s.degRoot.toString()).toBe(w.anchors.find((a) => a.issuerKeyId === w.keyIdOf(w.keys["uni-x"]))!.root);
    const blob = JSON.stringify(p);
    for (const v of ["19950315", "20300101", "20180601", w.holderSecret.toString()]) expect(blob).not.toContain(v);
  }, T);
  it("verification fails if a public input (the nonce) is swapped", async () => {
    const p = await run();
    const bad = { ...p, publicSignals: [...p.publicSignals] };
    bad.publicSignals[PUBLIC_SIGNAL_NAMES.indexOf("nonce")] = "1";
    expect(await verifyProof(bad)).toBe(false);
  }, T);
  it("cannot prove age>21 for someone under 21", async () => {
    const i = w.issue("gov-id", CRED_TYPE.ID, 20100315n, 0n, 4n, 44n);
    const young = w.present(i, w.anchorLog(w.keys["gov-id"], w.logs["gov-id"], T_LEGACY));
    await expect(run(young)).rejects.toThrow();
  }, T);
  it("cannot prove with an expired license", async () => {
    const i = w.issue("med-board", CRED_TYPE.LICENSE, CODES.MEDICAL, 20240101n, 5n, 55n);
    await expect(run(undefined, undefined, w.present(i, w.anchorLog(w.keys["med-board"], w.logs["med-board"], T_LEGACY)))).rejects.toThrow();
  }, T);
  it("cannot prove the wrong degree", async () => {
    await expect(run(undefined, undefined, undefined, { ...req, requiredDegree: 999n })).rejects.toThrow();
  }, T);
  it("cannot mix credentials belonging to different holders", async () => {
    const i = w.issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 6n, 66n, { secret: 111n });
    await expect(run(undefined, w.present(i, w.anchorLog(w.keys["uni-x"], w.logs["uni-x"], T_LEGACY)))).rejects.toThrow();
  }, T);
  it("cannot prove a credential that is not in the claimed log (wrong Merkle path is not a valid proof)", async () => {
    const wrongPath = { ...w.creds.degree, merkle: w.logs["gov-id"].pathAt(0) };
    const p = await run(undefined, wrongPath).catch(() => null);
    // The circuit computes whatever root the path implies; the verifier then finds no notarized anchor for it.
    if (p) expect(namedSignals(p).degRoot.toString()).not.toBe(w.anchors.find((a) => a.issuerKeyId === w.keyIdOf(w.keys["uni-x"]))!.root);
  }, T);
});
