import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { buildInput, type ZkProof } from "./proofinput";
export * from "./proofinput";

export interface Artifacts { wasm: string; zkey: string; vkey: string }
export const DEFAULT_ARTIFACTS: Artifacts = {
  wasm: "circuits/build/compound_proof_js/compound_proof.wasm",
  zkey: "circuits/build/compound.zkey",
  vkey: "circuits/build/compound_vkey.json",
};
/** Generates the compound proof. Throws if any predicate or signature is false (the witness cannot be built). */
export async function prove(input: Record<string, string | string[]>, a: Artifacts = DEFAULT_ARTIFACTS): Promise<ZkProof> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, a.wasm, a.zkey);
  return { proof, publicSignals };
}

export async function verifyProof(p: ZkProof, a: Artifacts = DEFAULT_ARTIFACTS): Promise<boolean> {
  const vkey = JSON.parse(readFileSync(a.vkey, "utf8"));
  return snarkjs.groth16.verify(vkey, p.publicSignals, p.proof);
}

