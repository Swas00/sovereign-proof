import { buildInput } from "../../../packages/core/proofinput";
import { credFromWire, reqToProof, type WireCred, type WireRequest } from "../../../packages/core/wire";

const WASM = "/artifacts/compound.wasm", ZKEY = "/artifacts/compound.zkey";
type Proved = { proof: any; publicSignals: string[] };

function viaWorker(input: Record<string, unknown>): Promise<Proved> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL("./prove.worker.ts", import.meta.url), { type: "module" }); } catch (e) { reject(Object.assign(new Error("no worker"), { infra: true })); return; }
    const done = () => w.terminate(); // one-shot: frees the proving memory right away (matters on phones)
    w.onmessage = (m) => { done(); m.data.ok ? resolve({ proof: m.data.proof, publicSignals: m.data.publicSignals }) : reject(Object.assign(new Error(m.data.error), { infra: !/Assert Failed/.test(m.data.error) })); };
    w.onerror = (e) => { done(); reject(Object.assign(new Error(e.message || "worker failed"), { infra: true })); };
    w.postMessage({ input, wasm: WASM, zkey: ZKEY });
  });
}

async function onMainThread(input: Record<string, unknown>): Promise<Proved> {
  const snarkjs = await import("snarkjs"); // loaded only when proving is actually needed
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals };
}

/**
 * The witness (DOB, expiry, holder secret, signatures) never leaves this tab. Proving runs in a Web Worker so the interface
 * does not freeze; if a browser cannot run it there, we fall back to the main thread. A genuine "your credentials do not
 * satisfy this request" failure is reported as such, never retried.
 */
export async function proveInBrowser(secret: string, id: WireCred, degree: WireCred, license: WireCred, req: WireRequest) {
  const input = buildInput(BigInt(secret), credFromWire(id), credFromWire(degree), credFromWire(license), reqToProof(req));
  try { return await viaWorker(input); }
  catch (e: any) { if (!e.infra) throw e; return onMainThread(input); }
}
