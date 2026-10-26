// Tries every account against every protected action and prints who is allowed and who is refused, with the server's own answer.
// Also tries the request-level attacks (unsigned, replayed, stale, tampered, wrong path, claimed identity). Exactly the matching role may
// succeed for each action; every other cell must be refused (401 or 403) and nothing else may change. Resets the demo.
// Needs the app running. Usage: npx tsx scripts/denied-matrix.ts   (APP=https://... for a deployed copy)
import { Wallet } from "ethers";
import { canonical } from "../packages/core/canonical";
import { sha256hex } from "../packages/core/registry";
import { DEMO_KEYS, requestMessage } from "../packages/core/signing";

const APP = (process.env.APP ?? "http://localhost:8787").replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) fails++; console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "   -> " + detail)); };
const get = (p: string) => fetch(APP + p).then((r) => r.json()) as Promise<any>;

type Who = "admin" | "gov-id" | "uni-x" | "uni-y" | "med-board" | "stranger" | "random wallet" | "unsigned";
const WHO: Who[] = ["admin", "gov-id", "uni-x", "uni-y", "med-board", "stranger", "random wallet", "unsigned"];
const random = Wallet.createRandom();
const walletOf = (w: Who) => (w === "unsigned" ? null : w === "random wallet" ? random : new Wallet(DEMO_KEYS[w]));

/** POST as `w`. `tweak` lets a test break one part of the request after it was signed. */
async function post(path: string, body: unknown, w: Who, tweak: { nonce?: string; ts?: number; sendBody?: unknown; sendPath?: string; claim?: string } = {}) {
  const payload = body ?? {}, headers: Record<string, string> = { "content-type": "application/json" };
  const wallet = walletOf(w);
  if (wallet) {
    const nonce = tweak.nonce ?? Math.random().toString(16).slice(2) + Date.now().toString(16), ts = tweak.ts ?? Date.now();
    headers["x-actor"] = tweak.claim ?? wallet.address; headers["x-nonce"] = nonce; headers["x-timestamp"] = String(ts);
    headers["x-signature"] = await wallet.signMessage(requestMessage("POST", path, sha256hex(canonical(payload)), nonce, ts));
  }
  const r = await fetch(APP + (tweak.sendPath ?? path), { method: "POST", headers, body: JSON.stringify(tweak.sendBody ?? payload) });
  const j = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, error: String(j.error ?? "") };
}
const cell = (r: { status: number }) => (r.status === 200 ? "ALLOWED" : r.status === 401 ? "no" : r.status === 403 ? "no" : String(r.status));

await fetch(APP + "/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
await sleep(1500);
const holderId = (await get("/api/demo/wallet/alice")).creds[0].fields.holderId as string;

type Action = { name: string; path: string; body: unknown; allowed: Who; prep?: () => Promise<unknown> };
const ISSUE = (issuerId: string, type: number) => ({ issuerId, type, profile: "alice", holderId, a1: type === 1 ? "19900101" : type === 2 ? "555" : "77", a2: type === 1 ? "0" : type === 2 ? "20240601" : "20300101", name: "Test Person", address: "1 Test Street", label: "matrix test" });
const actions: Action[] = [
  { name: "declare a key compromise", path: "/api/demo/declare", body: {}, allowed: "admin", prep: () => post("/api/demo/steal", {}, "unsigned") },
  { name: "re-attest a degree (epoch 2)", path: "/api/demo/reissue", body: { profile: "alice" }, allowed: "uni-x" },
  { name: "revoke a license", path: "/api/demo/revoke-license", body: { profile: "alice" }, allowed: "med-board" },
  { name: "restore data from the chain", path: "/api/demo/restore", body: {}, allowed: "admin" },
  { name: "issue a national ID", path: "/api/issue", body: ISSUE("gov-id", 1), allowed: "gov-id" },
  { name: "issue a degree as Northfield", path: "/api/issue", body: ISSUE("uni-x", 2), allowed: "uni-x" },
  { name: "issue a degree as Eastbrook", path: "/api/issue", body: ISSUE("uni-y", 2), allowed: "uni-y" },
  { name: "issue a license", path: "/api/issue", body: ISSUE("med-board", 3), allowed: "med-board" },
];

console.log(`--- who may do what (${APP})\n`);
const header = "action".padEnd(34) + WHO.map((w) => w.padEnd(14)).join("");
console.log(header); console.log("-".repeat(header.length));
for (const a of actions) {
  if (a.prep) await a.prep();
  const row: Record<string, { status: number; error: string }> = {};
  for (const w of WHO) if (w !== a.allowed) row[w] = await post(a.path, a.body, w); // refusals first: they must change nothing
  row[a.allowed] = await post(a.path, a.body, a.allowed);
  console.log(a.name.padEnd(34) + WHO.map((w) => cell(row[w]).padEnd(14)).join(""));
  ok(`${a.name}: only ${a.allowed} succeeds`, WHO.every((w) => (w === a.allowed ? row[w].status === 200 : row[w].status === 401 || row[w].status === 403)), JSON.stringify(Object.fromEntries(WHO.map((w) => [w, row[w].status]))));
  const sample = row.stranger.error || row["random wallet"].error; if (sample) console.log(`     refusal reads: ${sample}`);
}

console.log("\n--- request-level attacks (all must be refused)");
const declareBody = {};
const signedOnce = async () => { const nonce = "n-" + Date.now(), ts = Date.now(); const w = new Wallet(DEMO_KEYS.admin); return { nonce, ts, sig: await w.signMessage(requestMessage("POST", "/api/demo/restore", sha256hex(canonical(declareBody)), nonce, ts)) }; };
const raw = async (h: Record<string, string>, body: unknown = declareBody, path = "/api/demo/restore") => { const r = await fetch(APP + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }); return { status: r.status, error: String(((await r.json().catch(() => ({}))) as any).error ?? "") }; };
{
  const s = await signedOnce(), admin = new Wallet(DEMO_KEYS.admin).address;
  const h = { "x-actor": admin, "x-nonce": s.nonce, "x-timestamp": String(s.ts), "x-signature": s.sig };
  const first = await raw(h); ok("a correctly signed admin request works once", first.status === 200, JSON.stringify(first));
  const replay = await raw(h); ok("the same signed request replayed is refused", replay.status === 401 && /replay/.test(replay.error), JSON.stringify(replay));
}
{ const r = await post("/api/demo/restore", {}, "admin", { ts: Date.now() - 10 * 60_000 }); ok("an old (10 minute) signature is refused", r.status === 401 && /window/.test(r.error), JSON.stringify(r)); }
{ const r = await post("/api/demo/reissue", { profile: "alice" }, "uni-x", { sendBody: { profile: "mallory" } }); ok("changing the body after signing is refused", r.status === 401, JSON.stringify(r)); }
{ const r = await post("/api/demo/restore", {}, "admin", { sendPath: "/api/demo/declare" }); ok("a signature for one action cannot be used for another", r.status === 401, JSON.stringify(r)); }
{ const r = await post("/api/demo/restore", {}, "stranger", { claim: new Wallet(DEMO_KEYS.admin).address }); ok("claiming to be the admin while signing as someone else is refused", r.status === 401 && /does not match/.test(r.error), JSON.stringify(r)); }
{ const r = await raw({ "x-actor": new Wallet(DEMO_KEYS.admin).address, "x-nonce": "x", "x-timestamp": String(Date.now()), "x-signature": "0xdeadbeef" }); ok("a garbage signature is refused", r.status === 401, JSON.stringify(r)); }
{ const r = await post("/api/issue", { ...ISSUE("uni-x", 1) }, "uni-x"); ok("an issuer cannot sign a credential type it is not registered for (university signing a national ID)", r.status === 400 && /not authorized for this credential type/.test(r.error), JSON.stringify(r)); }
{ const r = await post("/api/issue", { ...ISSUE("nobody", 2) }, "admin"); ok("an unknown issuer name is refused", r.status === 403 || r.status === 400, JSON.stringify(r)); }

console.log("\n--- everything that was refused is on the record");
const pub = await get("/api/public");
const denied = pub.accessLog.filter((e: any) => e.outcome === "denied");
ok(`refused attempts were logged with the actor's address (${denied.length} entries)`, denied.length >= 40 && denied.every((e: any) => /^0x[0-9a-fA-F]{40}$/.test(e.actor) || e.actor === "-"));
const verify = await get("/api/access-log/verify");
ok("the access log still verifies against the chain", verify.ok === true, JSON.stringify(verify).slice(0, 160));

await fetch(APP + "/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
console.log(fails ? `\n${fails} FAILED` : "\nevery protected action is allowed to its own role only, and refused to everyone else");
process.exit(fails ? 1 : 0);
