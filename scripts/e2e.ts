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
const integrity = async (label: string) => { const r = await get("/api/integrity"); const bad = r.findings.filter((f: any) => !f.ok); console.log(`integrity check (${label}): ${r.clean ? "CLEAN" : bad.length + " PROBLEM(S)"}`); for (const f of bad) { console.log(`   ✗ ${f.subject}: ${f.summary}`); if (f.chain) console.log(`     chain says: published by ${f.chain.by} at ${f.chain.at} (block ${f.chain.block}, tx ${String(f.chain.tx).slice(0, 12)}…)`); for (const c of f.changes ?? []) console.log(`     was/now: ${c.path}: ${c.from} -> ${c.to}`); if (f.previous) console.log(`     ${f.previous}`); } return r; };
console.log("=== accountability: attempts, tampering, replay ===");
await integrity("before any attack");
await post("/api/demo/attempt-unauthorised");
let pub1 = await get("/api/public");
const rejected = pub1.chain.audit.filter((e: any) => e.kind === "rejected");
console.log(`outsider attempt -> ${rejected.length} refused attempts RECORDED on the chain:`); for (const e of rejected.slice(0, 3)) console.log(`   ${e.time.slice(0, 19)}  ${e.actorLabel} (${e.actor.slice(0, 10)}…)  ${e.action}: ${e.note}`);
await post("/api/demo/tamper-registry");
await present("alice", last, "Alice: after someone EDITED the stored registry").catch((e) => console.log(e.message));
await integrity("after registry tampering");
await post("/api/demo/restore");
await post("/api/demo/rollback-status");
await present("alice", last, "Alice: after an OLD status list was replayed (un-revoking her license)").catch((e) => console.log(e.message));
await integrity("after status-list replay");
await post("/api/demo/restore");
await integrity("after restoring from the verified archive");
const withChanges = (await get("/api/public")).chain.audit.filter((e: any) => e.changes?.length);
console.log("audit feed entries that show a readable previous -> new change:"); for (const e of withChanges) console.log(`   ${e.action} by ${e.actorLabel}: ` + e.changes.map((c: any) => `${c.path} ${c.from} -> ${c.to}`).join("; "));

await post("/api/demo/chain-outage", { on: true });
await present("alice", last, "chain unreachable (fail closed)").catch((e) => console.log(e.message));
await post("/api/demo/chain-outage", { on: false });
await post("/api/demo/outage", { on: true });
await present("alice", last, "status service offline (fail closed)").catch((e) => console.log(e.message));
await post("/api/demo/outage", { on: false });
const pub = await get("/api/public");
const c = pub.chain;
console.log(`chain: ${c.ok ? "online" : "OFFLINE"} · ${c.network} · block ${c.blockNumber} · registry versions on chain [${c.registry.map((r: any) => r.version)}] · ${pub.anchors.length} anchors, each with block+tx: ${pub.anchors.every((a: any) => a.chain?.txHash && a.chain.blockNumber > 0)}`);
if (!c.ok || c.registry.length !== 2 || c.registry[1].prevHash !== c.registry[0].hash || !c.registry[1].publisherLabel) { console.log("CHAIN RECORD MISMATCH"); process.exit(1); }
console.log("summary:", JSON.stringify(pub.summary), "| audit entries:", pub.audit.length);
const leak = JSON.stringify(pub);
for (const v of ["19950315", "987654321", "1122334455", "Alice Verma", "Harbor Lane", "Mallory Cross", "Dockside"]) if (leak.includes(v)) { console.log("LEAK in /api/public:", v); process.exit(1); }
console.log("no private values in public endpoint");
process.exit(0);
