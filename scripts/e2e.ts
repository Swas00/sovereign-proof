// Plays verifier + holder over HTTP against a running server, with real Groth16 proofs.
import { buildInput, prove } from "../packages/core/prover";
import { credFromWire, reqToProof, type WireCred, type WireRequest } from "../packages/core/wire";
import { Wallet } from "ethers";
import { createHash, randomUUID } from "node:crypto";
import { canonical } from "../packages/core/canonical";
import { DEMO_KEYS, requestMessage, type ActorRole } from "../packages/core/signing";

const API = process.env.API ?? "http://localhost:8787";
const post = async (p: string, b: unknown = {}) => { const r = await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(p + ": " + JSON.stringify(j)); return j; };
const get = async (p: string) => (await fetch(API + p)).json();
// Signed requests (EIP-191), exactly as the browser sends them.
async function headersFor(path: string, body: unknown, role: ActorRole, opts: { ts?: number; nonce?: string; bodyForHash?: unknown } = {}) {
  const w = new Wallet(DEMO_KEYS[role]), nonce = opts.nonce ?? randomUUID(), ts = opts.ts ?? Date.now();
  const sha = createHash("sha256").update(canonical(opts.bodyForHash ?? body ?? {})).digest("hex");
  return { "content-type": "application/json", "x-actor": w.address, "x-nonce": nonce, "x-timestamp": String(ts), "x-signature": await w.signMessage(requestMessage("POST", path, sha, nonce, ts)) };
}
const send = async (path: string, body: unknown, headers?: Record<string, string>) => { const r = await fetch(API + path, { method: "POST", headers: headers ?? { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const psigned = async (path: string, body: unknown, role: ActorRole) => { const r = await send(path, body, await headersFor(path, body, role)); if (r.status !== 200) throw new Error(`${path} as ${role}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

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
await psigned("/api/demo/declare", {}, "admin");
await present("mallory", last, "Mallory: thief-issued fake degree");
await present("alice", first, "Alice: legacy degree from the same compromised key");
await psigned("/api/demo/reissue", { profile: "alice" }, "uni-x");
await present("alice", last, "Alice: degree re-issued under epoch 2 key");
await psigned("/api/demo/revoke-license", { profile: "alice" }, "med-board");
await present("alice", last, "Alice: after her license is revoked");
const integrity = async (label: string) => { const r = await get("/api/integrity"); const bad = r.findings.filter((f: any) => !f.ok); console.log(`integrity check (${label}): ${r.clean ? "CLEAN" : bad.length + " PROBLEM(S)"}`); for (const f of bad) { console.log(`   ✗ ${f.subject}: ${f.summary}`); if (f.chain) console.log(`     chain says: published by ${f.chain.by} at ${f.chain.at} (block ${f.chain.block}, tx ${String(f.chain.tx).slice(0, 12)}…)`); for (const c of f.changes ?? []) console.log(`     was/now: ${c.path}: ${c.from} -> ${c.to}`); if (f.previous) console.log(`     ${f.previous}`); for (const x of f.forensics ?? []) console.log(`     forensics: ${x}`); } return r; };
console.log("=== accountability: attempts, tampering, replay ===");
await integrity("before any attack");
await post("/api/demo/attempt-unauthorised");
let pub1 = await get("/api/public");
const rejected = pub1.chain.audit.filter((e: any) => e.kind === "rejected");
console.log(`outsider attempt -> ${rejected.length} refused attempts RECORDED on the chain:`); for (const e of rejected.slice(0, 3)) console.log(`   ${e.time.slice(0, 19)}  ${e.actorLabel} (${e.actor.slice(0, 10)}…)  ${e.action}: ${e.note}`);
await post("/api/demo/tamper-registry");
await present("alice", last, "Alice: after someone EDITED the stored registry").catch((e) => console.log(e.message));
await integrity("after registry tampering");
await psigned("/api/demo/restore", {}, "admin");
await post("/api/demo/rollback-status");
await present("alice", last, "Alice: after an OLD status list was replayed (un-revoking her license)").catch((e) => console.log(e.message));
await integrity("after status-list replay");
await psigned("/api/demo/restore", {}, "admin");
await integrity("after restoring from the chain");
const withChanges = (await get("/api/public")).chain.audit.filter((e: any) => e.changes?.length);
console.log("audit feed entries that show a readable previous -> new change:"); for (const e of withChanges) console.log(`   ${e.action} by ${e.actorLabel}: ` + e.changes.map((c: any) => `${c.path} ${c.from} -> ${c.to}`).join("; "));

console.log("=== who may write: every privileged call must be signed by the right account ===");
let fails = 0; const expect = (name: string, got: number, want: number) => { if (got !== want) fails++; console.log(`  ${got === want ? "ok  " : "FAIL"} ${name} -> HTTP ${got} (expected ${want})`); };
const P = "/api/demo/declare";
expect("unsigned request", (await send(P, {})).status, 401);
expect("signed by a stranger's key", (await send(P, {}, await headersFor(P, {}, "stranger"))).status, 403);
expect("signed by a real account acting outside its role (med-board declaring a compromise)", (await send(P, {}, await headersFor(P, {}, "med-board"))).status, 403);
expect("body altered after signing", (await send(P, { x: 1 }, await headersFor(P, { x: 1 }, "admin", { bodyForHash: { x: 2 } }))).status, 401);
expect("stale timestamp (10 minutes old)", (await send(P, {}, await headersFor(P, {}, "admin", { ts: Date.now() - 600_000 }))).status, 401);
expect("signature for one path replayed on another", (await send("/api/demo/revoke-license", { profile: "alice" }, await headersFor(P, { profile: "alice" }, "admin"))).status, 401);
const hdr = await headersFor("/api/demo/reissue", { profile: "none" }, "uni-x");
const firstTry = await send("/api/demo/reissue", { profile: "none" }, hdr), again = await send("/api/demo/reissue", { profile: "none" }, hdr);
expect("a valid signed request is authenticated (then rejected on its own merits: unknown profile)", firstTry.status, 400);
expect("the SAME signed request replayed (nonce already used)", again.status, 401);
const log1 = await (await fetch(API + "/api/access-log/verify")).json();
console.log(`access log: ${log1.ok ? "INTACT" : "TAMPERED"} (${log1.entries} entries, ${log1.anchored} anchored on the chain)`);
const denied = (await get("/api/public")).accessLog.filter((e: any) => e.outcome === "denied");
console.log(`  ${denied.length} denied requests are in the log, each naming the signer or "(anonymous)": ${[...new Set(denied.map((e: any) => e.actorLabel))].join(" | ")}`);
if (!log1.ok || fails) { console.log("AUTH CHECKS FAILED"); process.exit(1); }
await post("/api/demo/tamper-log");
const log2 = await (await fetch(API + "/api/access-log/verify")).json();
console.log(`someone rewrote a log entry -> verification: ${log2.ok ? "NOT DETECTED (BAD)" : "TAMPERING DETECTED"}; first altered entry #${log2.firstBad}; last entry proven intact #${log2.lastGoodAnchor?.seq} (block ${log2.lastGoodAnchor?.block}, ${log2.lastGoodAnchor?.time})`);
if (log2.ok) process.exit(1);
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
await post("/api/demo/reset"); // leave the server in a clean state
process.exit(0);
