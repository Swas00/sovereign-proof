import * as snarkjs from "snarkjs";
import { buildInput } from "../../../packages/core/proofinput";
import { credFromWire, reqToProof, type WireCred, type WireRequest } from "../../../packages/core/wire";

/** Runs entirely in the browser: the witness (DOB, expiry, holder secret, signatures) never leaves this tab. */
export async function proveInBrowser(secret: string, id: WireCred, degree: WireCred, license: WireCred, req: WireRequest) {
  const input = buildInput(BigInt(secret), credFromWire(id), credFromWire(degree), credFromWire(license), reqToProof(req));
  return snarkjs.groth16.fullProve(input, "/artifacts/compound.wasm", "/artifacts/compound.zkey");
}
