// Plays verifier + holder over HTTP against a running server, with real Groth16 proofs.
import { buildInput, prove } from "../packages/core/prover";
import { credFromWire, reqToProof, type WireCred, type WireRequest } from "../packages/core/wire";

const API = process.env.API ?? "http://localhost:8787";
const post = async (p: string, b: unknown = {}) => { const r = await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(p + ": " + JSON.stringify(j)); return j; };
const get = async (p: string) => (await fetch(API + p)).json();

async function present(profile: string, pick: (c: WireCred[]) => WireCred[], label: string, opts: any = {}) {
  const wallet = await get(`/api/demo/wallet/${profile}`);
  const req: WireRequest = await post("/api/verifier/request", { requiredDegreeIssuer: "uni-x", ageYears: 21, ...opts });
  const creds = pick(wallet.creds);
  const by = (role: string) => credFromWire(creds.find((c) => c.role === role)!);
  const p = await prove(buildInput(BigInt(wallet.holderSecret), by("id"), by("degree"), by("license"), reqToProof(req)));
  const res = await post("/api/verifier/verify", { requestId: req.id, proof: p });
  const bad = res.steps.filter((s: any) => s.outcome !== "pass");
  console.log(`${label.padEnd(58)} -> ${res.verdict.toUpperCase()}${bad.length ? "  [" + bad.map((s: any) => s.id + ":" + s.outcome).join(", ") + "]" : ""}`);
  return res;
}
const last = (cs: WireCred[]) => ["id", "degree", "license"].map((r) => cs.filter((c) => c.role === r).pop()!);
const first = (cs: WireCred[]) => ["id", "degree", "license"].map((r) => cs.find((c) => c.role === r)!);

await post("/api/demo/reset");
console.log("=== BEFORE the incident (registry v1) ===");
await present("alice", first, "Alice: degree + age>21 + license");
await post("/api/demo/steal");
await present("mallory", last, "Mallory: thief-issued fake degree (undetected so far)");
console.log("=== key compromise declared (registry v2) ===");
await post("/api/demo/declare");
await present("mallory", last, "Mallory: thief-issued fake degree");
await present("alice", first, "Alice: legacy degree from the same compromised key");
await post("/api/demo/reissue", { profile: "alice" });
await present("alice", last, "Alice: degree re-issued under epoch 2 key");
await post("/api/demo/revoke-license", { profile: "alice" });
await present("alice", last, "Alice: after her license is revoked");
await post("/api/demo/outage", { on: true });
await present("alice", last, "status service offline (fail closed)").catch((e) => console.log(e.message));
await post("/api/demo/outage", { on: false });
const pub = await get("/api/public");
console.log("summary:", JSON.stringify(pub.summary), "| audit entries:", pub.audit.length);
const leak = JSON.stringify(pub);
for (const v of ["19950315", "987654321", "1122334455"]) if (leak.includes(v)) { console.log("LEAK in /api/public:", v); process.exit(1); }
console.log("no private values in public endpoint");
process.exit(0);
