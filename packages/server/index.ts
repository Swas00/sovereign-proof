import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CRED_TYPE } from "../core/crypto";
import { verifyPresentation, type VerifierRequest, type VerificationResult } from "../core/verify";
import { CATALOG, credToWire, reqToProof, type WireRequest } from "../core/wire";
import { rootFromPath } from "../core/merkle";
import { CODES } from "../core/fixtures";
import { createState, type State } from "./state";

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve(import.meta.dirname, "../..");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let st: State = await createState();
const app = express();
app.use(express.json({ limit: "256kb" }));

const wrap = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try { await fn(req, res); } catch (e: any) { res.status(400).json({ error: e.message ?? "bad request" }); }
};
const dec = (v: unknown, name: string, max = FIELD): bigint => {
  if (typeof v !== "string" || !/^\d{1,80}$/.test(v)) throw new Error(`${name} must be a decimal string`);
  const n = BigInt(v); if (n >= max) throw new Error(`${name} out of range`); return n;
};

// Circuit artifacts for in-browser proving (public, they contain no secrets).
const B = resolve(ROOT, "circuits/build");
app.get("/artifacts/compound.wasm", (_q, r) => r.sendFile(resolve(B, "compound_proof_js/compound_proof.wasm")));
app.get("/artifacts/compound.zkey", (_q, r) => r.sendFile(resolve(B, "compound.zkey")));
app.get("/artifacts/compound_vkey.json", (_q, r) => r.sendFile(resolve(B, "compound_vkey.json")));

app.get("/api/public", wrap((_q, r) => {
  const keyStatus = st.registry.body.issuers.flatMap((i) => i.keys.map((k) => ({ issuerId: i.issuerId, ...k })));
  r.json({
    phase: st.phase, outage: st.outage, catalog: CATALOG,
    registry: st.registry, history: st.history.map((h) => ({ version: h.body.version, issuedAt: h.body.issuedAt, hash: h.hash, note: h.body.note })),
    keyStatus, anchors: st.w.anchors.map((a) => ({ ...a, sig: undefined })), summary: st.summary(),
    revokedSlots: Object.fromEntries(Object.entries(st.revoked).map(([k, v]) => [k, v.length])),
    events: st.log.slice(-40), audit: st.audit.slice(-30),
  });
}));

app.get("/api/demo/wallet/:profile", wrap((q, r) => {
  const w = st.wallets[q.params.profile]; if (!w) throw new Error("unknown profile");
  r.json(w);
}));
app.post("/api/demo/steal", wrap((_q, r) => { st.steal(); r.json({ ok: true }); }));
app.post("/api/demo/declare", wrap((_q, r) => { st.declare(); r.json({ ok: true }); }));
app.post("/api/demo/reissue", wrap((q, r) => { st.reissue(String(q.body.profile)); r.json({ ok: true }); }));
app.post("/api/demo/revoke-license", wrap((q, r) => { st.revokeLicense(String(q.body.profile)); r.json({ ok: true }); }));
app.post("/api/demo/outage", wrap((q, r) => { st.outage = !!q.body.on; st.event("status", st.outage ? "status service taken offline" : "status service restored"); r.json({ ok: true }); }));
app.post("/api/demo/reset", wrap(async (_q, r) => { st = await createState(); r.json({ ok: true }); }));

// Issuance: the holder sends only their holderId (a hash); the issuer never sees the holder secret.
app.post("/api/issue", wrap((q, r) => {
  const issuer = st.registry.body.issuers.find((i) => i.issuerId === q.body.issuerId); if (!issuer) throw new Error("unknown issuer");
  const type = Number(q.body.type); if (![1, 2, 3].includes(type) || !issuer.credTypes.includes(type)) throw new Error("issuer is not authorized for this credential type");
  const holderId = dec(q.body.holderId, "holderId"), a1 = dec(q.body.a1, "a1", 2n ** 32n), a2 = dec(q.body.a2, "a2", 2n ** 32n);
  const w = st.w;
  const activeKey = issuer.issuerId === "uni-x" && st.epoch2 ? st.epoch2 : w.keys[issuer.issuerId];
  const log = issuer.issuerId === "uni-x" && st.epoch2 ? st.epoch2Log : w.logs[issuer.issuerId];
  const fields = { type: BigInt(type), holderId, a1, a2, statusIndex: st.nextStatusIndex(), salt: BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex")) };
  const m = w.c.commitment(fields);
  const index = log.append(m);
  const anchor = w.anchorLog(activeKey, log, st.issueClock());
  const cred = { fields, sig: w.c.sign(activeKey.prv, m), issuerPub: activeKey.pub, merkle: log.pathAt(index, anchor.leafCount) };
  const role = type === 1 ? "id" : type === 2 ? "degree" : "license";
  st.event("issuer", `${issuer.issuerId} issued a ${role} credential (anchored ${anchor.anchoredAt}); no holder identity recorded`);
  r.json(credToWire(role, String(q.body.label ?? role), issuer.issuerId, rootFromPath(w.c, m, cred.merkle), cred));
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
  const req: VerifierRequest = { ...reqToProof(wire), requiredIssuers: wire.requiredIssuers, onStatusUnavailable: wire.onStatusUnavailable };
  const result: VerificationResult = await verifyPresentation({ proof: proof.proof, publicSignals: proof.publicSignals.map(String) }, req, {
    crypto: st.w.c, registry: st.registry, pinnedRegistry: st.pinned, adminPub: st.w.admin.pub, anchors: st.w.anchors, notaryPub: st.w.notary.pub,
    statusLists: st.lists(), nonces: st.nonces, now: Date.now(),
  });
  if (result.steps[0]?.id === "registry" && result.steps[0].outcome === "pass") st.pinned = st.registry;
  // Audit entries hold only public material: verdict, per-step outcomes and issuer ids.
  st.audit.push({ t: new Date().toISOString(), auditId: result.auditId, verdict: result.verdict, issuers: result.disclosed.issuers.map((i) => i.issuerId), steps: result.steps.map((s) => `${s.id}:${s.outcome}`) });
  r.json(result);
}));

const dist = resolve(ROOT, "apps/web/dist");
if (existsSync(dist)) { app.use(express.static(dist)); }
app.listen(PORT, () => console.log(`Sovereign Proof API on http://localhost:${PORT}`));
