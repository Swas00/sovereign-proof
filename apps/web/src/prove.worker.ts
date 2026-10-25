// Runs the Groth16 witness calculation and proof generation off the main thread, so the page stays responsive while proving.
import * as snarkjs from "snarkjs";

self.onmessage = async (e: MessageEvent<{ input: Record<string, unknown>; wasm: string; zkey: string }>) => {
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(e.data.input, e.data.wasm, e.data.zkey);
    (self as unknown as Worker).postMessage({ ok: true, proof, publicSignals });
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err?.message ?? err) });
  }
};
