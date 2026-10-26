import express from "express";
import compression from "compression";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CRED_TYPE } from "../core/crypto";
import { verifyPresentation, type VerifierRequest, type VerificationResult } from "../core/verify";
import { CATALOG, credToWire, reqToProof, type WireRequest } from "../core/wire";
import { rootFromPath } from "../core/merkle";
import { CODES } from "../core/fixtures";
import { createState, type State } from "./state";
import { ACCOUNT, Chain, RPC_URL } from "./chain";
import { AuthError, authenticate } from "./auth";
import { canonical } from "../core/canonical";
import { sha256hex } from "../core/registry";
import { receiptText } from "../core/receipt";
import { rpcGateway } from "./rpcproxy";
import { rateLimit } from "./ratelimit";

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve(import.meta.dirname, "../..");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const chain = await Chain.connect(); // retries ~25s so `npm run dev` can start both together; never throws
if (!chain.online) console.warn("chain unreachable at startup:", chain.error, "(verifiers will fail closed)");
let st: State = await createState(chain);
const app = express();
app.set("trust proxy", 1); // behind a host's HTTPS proxy: req.protocol and req.ip come from X-Forwarded-*
// text assets (JS, CSS, JSON, WASM) are sent compressed; the 22 MB proving key is binary and barely shrinks, so it is left alone
app.use(compression({ filter: (req, res) => (req.path.endsWith(".zkey") ? false : compression.filter(req, res)) }));
app.use(express.json({ limit: "256kb" }));
// Abuse limits for a public deployment (requests from this computer are exempt). The demo controls take no signature by design, so
// the heavy ones get a tighter limit; the wallet gateway and the rest of the API get generous ones.
app.use(["/api/demo/reset", "/api/demo/steal"], rateLimit(10, 60_000, "heavy"));
app.use("/api", rateLimit(120, 60_000, "api"));
app.use("/rpc", rateLimit(600, 60_000, "rpc"));
app.get("/healthz", (_q, r) => { r.json({ ok: true, chain: chain.online }); }); // for the host's health check and keep-alive pings

const wrap = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try { await fn(req, res); } catch (e: any) { res.status(400).json({ error: e.message ?? "bad request" }); }
};
/**
 * Every write goes through here. Privileged actions need a signature from the right account: the signer is recovered, never
 * trusted from a header, and must be the admin or that issuer's own account. Whatever happens (accepted, denied, error), the
 * attempt is written to the hash-chained access log, whose head is anchored on the chain.
 */
type Req = express.Request; type Res = express.Response;
const roleAddress = (need: string) => (need === "admin" ? chain.addressOf(ACCOUNT.admin) : need.startsWith("issuer:") ? chain.addressOf((ACCOUNT as any)[need.slice(7)] ?? -1) : "");
const audited = (detail: string, need: null | ((req: Req) => string), fn: (req: Req, res: Res) => unknown) => async (req: Req, res: Res) => {
  const bodySha256 = sha256hex(canonical(req.body ?? {}));
  let actor = "-", actorLabel = need ? "(anonymous)" : "(demo control, unauthenticated)";
  try {
    if (need) {
      const requires = need(req);
      actor = authenticate(req); actorLabel = chain.labelOf(actor);
      const want = roleAddress(requires);
      if (!want || actor.toLowerCase() !== want.toLowerCase()) throw new AuthError(403, `${actorLabel} is not authorised for this action (requires ${requires})`, actor);
    }
    await fn(req, res);
    await st.logAccess({ actor, actorLabel, method: req.method, path: req.path, bodySha256, outcome: "ok", detail });
  } catch (e: any) {
    const denied = e instanceof AuthError;
    if (denied && actor === "-" && e.actor) { actor = e.actor; actorLabel = `${chain.labelOf(e.actor)} (claimed, not verified)`; }
    await st.logAccess({ actor, actorLabel, method: req.method, path: req.path, bodySha256, outcome: denied ? "denied" : "error", detail: `${detail}: ${e.message ?? "failed"}` });
    if (!res.headersSent) res.status(denied ? e.status : 400).json({ error: e.message ?? "bad request" });
  }
};
/** True if some verification this server ran hashes to this on-chain receipt (so the wallet's claim matches a real audit record). */
const receiptMatches = (receiptHex: string, version: number) =>
  st.audit.some((a: any) => a.steps0 && a.registryVersion === version && sha256hex(receiptText({ auditId: a.auditId, verdict: a.verdict, steps: a.steps0, registryVersion: a.registryVersion })) === receiptHex);
const dec = (v: unknown, name: string, max = FIELD): bigint => {
  if (typeof v !== "string" || !/^\d{1,80}$/.test(v)) throw new Error(`${name} must be a decimal string`);
  const n = BigInt(v); if (n >= max) throw new Error(`${name} out of range`); return n;
};

// Circuit artifacts for in-browser proving (public, they contain no secrets).
const B = resolve(ROOT, "circuits/build");
const artifact = (file: string) => (_q: express.Request, r: express.Response) => r.set("Cache-Control", "public, max-age=86400").sendFile(resolve(B, file)); // proving files never change between builds
app.get("/artifacts/compound.wasm", artifact("compound_proof_js/compound_proof.wasm"));
app.get("/artifacts/compound.zkey", artifact("compound.zkey"));
app.get("/artifacts/compound_vkey.json", artifact("compound_vkey.json"));

app.get("/api/public", wrap(async (_q, r) => {
  const snap = await chain.snapshot();
  const keyStatus = st.registry.body.issuers.flatMap((i) => i.keys.map((k) => ({ issuerId: i.issuerId, ...k })));
  r.json({
    phase: st.phase, outage: st.outage, catalog: CATALOG,
    registry: st.registry, history: st.history.map((h) => ({ version: h.body.version, issuedAt: h.body.issuedAt, hash: h.hash, note: h.body.note })),
    keyStatus, anchors: snap.anchors.map((a) => ({ ...a, sig: undefined })), summary: snap.ok ? st.summary(snap.anchors) : undefined,
    receipts: snap.receipts.map((x) => ({ ...x, matchesAudit: receiptMatches(x.receipt, x.registryVersion) })),
    chain: { ok: snap.ok, error: snap.error, network: snap.network, rpc: snap.rpc, contract: snap.contract, blockNumber: snap.blockNumber, blockTime: snap.blockTime, registry: snap.registry, audit: st.enrichAudit(snap).reverse(), auditHeads: snap.auditHeads, simulatedOutage: chain.forceOffline },
    accessLog: st.accessLog.entries.slice(-60).reverse(),
    revokedSlots: Object.fromEntries(Object.entries(st.revoked).map(([k, v]) => [k, v.length])),
    events: st.log.slice(-40), audit: st.audit.slice(-30),
  });
}));

// Browser-wallet support: network details for MetaMask, a local-only faucet for free test ETH, and receipt cross-checking.
// Public JSON-RPC gateway for browser wallets: reads, plus signed recordVerification receipts only (see rpcproxy.ts).
app.post("/rpc", rpcGateway(RPC_URL, () => chain.address, () => 31337));
// A wallet on this computer talks to the node directly. Anyone else (a deployed site, a phone on the Wi-Fi) must use the gateway, and
// MetaMask only accepts https RPC addresses off localhost, so the gateway URL is built from the address the page was loaded from.
const isLocalHost = (h?: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h ?? "");
app.get("/api/chain/info", wrap(async (q, r) => {
  if (!chain.online) throw new Error("chain unreachable");
  const host = q.get("host");
  r.json(await chain.info(isLocalHost(host) ? undefined : `${q.protocol}://${host}/rpc`));
}));
app.post("/api/wallet/fund", audited("sent test ETH to a wallet (local faucet)", null, async (q, r) => { r.json(await chain.fund(String(q.body?.address ?? ""))); }));

app.get("/api/demo/wallet/:profile", wrap((q, r) => {
  const w = st.wallets[q.params.profile]; if (!w) throw new Error("unknown profile");
  r.json(w);
}));
// Privileged actions (signed by an authorised account) ...
app.post("/api/demo/declare", audited("declared the uni-x key compromised", () => "admin", async (_q, r) => { await st.declare(); r.json({ ok: true }); }));
app.post("/api/demo/reissue", audited("re-attested a degree under the replacement key", () => "issuer:uni-x", async (q, r) => { await st.reissue(String(q.body.profile)); r.json({ ok: true }); }));
app.post("/api/demo/revoke-license", audited("revoked a license slot", () => "issuer:med-board", async (q, r) => { await st.revokeLicense(String(q.body.profile)); r.json({ ok: true }); }));
app.post("/api/demo/restore", audited("restored served data from the chain", () => "admin", async (_q, r) => { await st.restore(); r.json({ ok: true }); }));
// ... and demo controls that stand for an adversary or the test harness. They need no signature (that is the point), but they are logged too.
app.post("/api/demo/steal", audited("simulated attacker used the stolen uni-x key", null, async (_q, r) => { await st.steal(); r.json({ ok: true }); }));
app.post("/api/demo/attempt-unauthorised", audited("an outsider tried to write to the chain", null, async (_q, r) => { await st.attemptUnauthorised(); r.json({ ok: true }); }));
app.post("/api/demo/tamper-registry", audited("someone edited the stored registry", null, (_q, r) => { st.tamperRegistry(); r.json({ ok: true }); }));
app.post("/api/demo/rollback-status", audited("someone replayed an old status list", null, (_q, r) => { st.rollbackStatus(); r.json({ ok: true }); }));
app.post("/api/demo/tamper-log", audited("someone rewrote an access-log entry", null, (_q, r) => { st.tamperAccessLog(); r.json({ ok: true }); }));
app.get("/api/integrity", wrap(async (_q, r) => { r.json(await st.integrity()); }));
app.get("/api/access-log/verify", wrap(async (_q, r) => { r.json(await st.verifyAccessLog()); }));
app.post("/api/demo/outage", audited("status service toggled", null, (q, r) => { st.outage = !!q.body.on; st.event("status", st.outage ? "status service taken offline" : "status service restored"); r.json({ ok: true }); }));
app.post("/api/demo/chain-outage", audited("chain outage toggled", null, (q, r) => { chain.forceOffline = !!q.body.on; st.event("chain", chain.forceOffline ? "chain taken offline (simulated): verifiers fail closed" : "chain back online"); r.json({ ok: true }); }));
app.post("/api/demo/reset", audited("reset demo", null, async (_q, r) => { chain.forceOffline = false; await chain.ping(3, 500); st = await createState(chain); r.json({ ok: true }); }));

// Issuance: the holder sends only their holderId (a hash); the issuer never sees the holder secret.
app.post("/api/issue", audited("issued a credential", (q) => `issuer:${String(q.body?.issuerId)}`, async (q, r) => {
  const issuer = st.registry.body.issuers.find((i) => i.issuerId === q.body.issuerId); if (!issuer) throw new Error("unknown issuer");
  const type = Number(q.body.type); if (![1, 2, 3].includes(type) || !issuer.credTypes.includes(type)) throw new Error("issuer is not authorized for this credential type");
  const holderId = dec(q.body.holderId, "holderId"), a1 = dec(q.body.a1, "a1", 2n ** 32n);
  let a2: bigint, priv: { name: string; address: string } | undefined;
  if (type === 1) {
    const text = (v: unknown, n: string) => { if (typeof v !== "string" || v.trim().length < 1 || v.length > 80) throw new Error(`${n} must be 1 to 80 characters`); return v.trim(); };
    priv = { name: text(q.body.name, "name"), address: text(q.body.address, "address") };
    a2 = st.w.c.identityBinding(priv.name, priv.address); // the issuer signs a hash; the verifier never receives either value
  } else a2 = dec(q.body.a2, "a2", 2n ** 32n);
  const w = st.w;
  const activeKey = issuer.issuerId === "uni-x" && st.epoch2 ? st.epoch2 : w.keys[issuer.issuerId];
  const log = issuer.issuerId === "uni-x" && st.epoch2 ? st.epoch2Log : w.logs[issuer.issuerId];
  const fields = { type: BigInt(type), holderId, a1, a2, statusIndex: st.nextStatusIndex(), salt: BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex")) };
  const m = w.c.commitment(fields);
  const index = log.append(m);
  const anchor = w.anchorLog(activeKey, log, st.issueClock());
  await st.syncChain(); // record the new log root on the chain
  const cred = { fields, sig: w.c.sign(activeKey.prv, m), issuerPub: activeKey.pub, merkle: log.pathAt(index, anchor.leafCount) };
  const role = type === 1 ? "id" : type === 2 ? "degree" : "license";
  st.event("issuer", `${issuer.issuerId} issued a ${role} credential (root anchored on the chain); no holder identity recorded`);
  const wire = credToWire(role, String(q.body.label ?? role).slice(0, 80), issuer.issuerId, rootFromPath(w.c, m, cred.merkle), cred, priv);
  // Hand the credential to the holder's wallet only if the supplied holderId really is that wallet's id.
  const wallet = st.wallets[String(q.body.profile ?? "")];
  if (wallet && wallet.creds[0]?.fields.holderId === holderId.toString()) wallet.creds.push(wire);
  r.json(wire);
}));

// Verifier role. The server remembers the requests IT issued, so a client cannot weaken the policy.
app.post("/api/verifier/request", wrap((q, r) => {
  const ageYears = Math.min(Math.max(Number(q.body.ageYears ?? 21), 0), 120);
  const today = CATALOG.today, cutoff = String(Number(today) - ageYears * 10000);
  const nonce = st.nonces.issue(Date.now());
  const req: WireRequest = {
    id: nonce.toString(), nonce: nonce.toString(), ageCutoff: cutoff, today,
    requiredDegree: dec(String(q.body.requiredDegree ?? CATALOG.degrees[0].code), "requiredDegree", 2n ** 32n).toString(),
    requiredLicense: dec(String(q.body.requiredLicense ?? CATALOG.licenses[0].code), "requiredLicense", 2n ** 32n).toString(),
    ageYears, expiresAt: Date.now() + 5 * 60_000,
    requiredIssuers: q.body.requiredDegreeIssuer ? { degree: String(q.body.requiredDegreeIssuer) } : undefined,
    onStatusUnavailable: q.body.onStatusUnavailable === "warn" ? "warn" : "reject",
  };
  st.requests.set(req.id, req);
  r.json(req);
}));

app.post("/api/verifier/verify", wrap(async (q, r) => {
  const wire = st.requests.get(String(q.body.requestId));
  const proof = q.body.proof;
  if (!wire || !proof || !Array.isArray(proof.publicSignals) || !proof.proof) throw new Error("unknown request or malformed proof");
  const snap = await chain.snapshot(); // the verifier reads the chain itself, not our in-memory state
  const req: VerifierRequest = { ...reqToProof(wire), requiredIssuers: wire.requiredIssuers, onStatusUnavailable: wire.onStatusUnavailable };
  const result: VerificationResult = await verifyPresentation({ proof: proof.proof, publicSignals: proof.publicSignals.map(String) }, req, {
    crypto: st.w.c, registry: st.registry, pinnedRegistry: st.pinned, adminPub: st.w.admin.pub, anchors: snap.ok ? snap.anchors : [], notaryPub: st.w.notary.pub,
    chain: { ok: snap.ok, error: snap.error, blockNumber: snap.blockNumber, registry: snap.registry.map((r) => ({ version: r.version, hash: r.hash })),
      status: Object.fromEntries(Object.entries(snap.status).map(([k, a]) => [k, { version: a[a.length - 1].version, hash: a[a.length - 1].hash }])) },
    statusLists: st.lists(), nonces: st.nonces, now: Date.now(),
  });
  if (result.steps[0]?.id === "registry" && result.steps[0].outcome === "pass") st.pinned = st.registry;
  // Audit entries hold only public material: verdict, per-step outcomes and issuer ids.
  const registryVersion = st.registry.body.version;
  st.audit.push({ t: new Date().toISOString(), auditId: result.auditId, verdict: result.verdict, registryVersion, steps0: result.steps.map((s) => ({ id: s.id, outcome: s.outcome })), issuers: result.disclosed.issuers.map((i) => i.issuerId), steps: result.steps.map((s) => `${s.id}:${s.outcome}`) });
  r.json({ ...result, registryVersion });
}));

const dist = resolve(ROOT, "apps/web/dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h", setHeaders: (res, path) => {
    if (/[\\/]assets[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // content-hashed filenames
    else if (/[\\/]hero[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=86400");
  } }));
}
// Loopback by default: the demo controls (reset, simulated theft, faucet) take no signature, so they must not be reachable from the
// venue network. To test from a phone on the same Wi-Fi, start with HOST=0.0.0.0 and stop it again afterwards.
const HOST = process.env.HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => console.log(`Sovereign Proof API on http://localhost:${PORT}` + (HOST === "127.0.0.1" ? " (this computer only)" : ` (listening on ${HOST}: reachable from the network)`)));
