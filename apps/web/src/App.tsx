import { type ReactElement, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Eye, Landmark, Lock, Moon, ScrollText, ShieldCheck, Stamp, Sun, TriangleAlert, Wallet as WalletIcon, X } from "lucide-react";
import { toggleTheme, useTheme } from "./theme";
import { ROUTE_ROLE, signedPost } from "./signer";
import WaveMesh from "@/components/ui/wave-mesh";
import WalletPill from "@/components/WalletPill";
import ActingAs from "@/components/ActingAs";
import WalletGuide from "@/components/WalletGuide";
import { anchorReceipt, connect, friendlyError, getWallet, shortAddr, useWalletState } from "./wallet";
import { receiptText } from "../../../packages/core/receipt";
import { api } from "./api";
import { proveInBrowser } from "./prove";
import type { WireCred, WireRequest } from "../../../packages/core/wire";

type Tab = "verify" | "wallet" | "trust" | "issue" | "audit";
const TABS: Tab[] = ["verify", "wallet", "trust", "issue", "audit"];
const Landing = lazy(() => import("./Landing"));
// "#app" or "#app/<tab>" opens the application; anything else shows the landing page.
function readRoute(): { view: "landing" | "app"; tab?: Tab } {
  const h = window.location.hash;
  if (!h.startsWith("#app")) return { view: "landing" };
  const t = h.split("/")[1] as Tab | undefined;
  return { view: "app", tab: t && TABS.includes(t) ? t : undefined };
}
const ICON: Record<string, ReactElement> = {
  pass: <Check size={15} strokeWidth={2.4} aria-hidden />, fail: <X size={15} strokeWidth={2.4} aria-hidden />,
  quarantine: <TriangleAlert size={15} strokeWidth={2.2} aria-hidden />, warn: <CircleAlert size={15} strokeWidth={2.2} aria-hidden />,
};
const NAV_ICON: Record<Tab, ReactElement> = {
  verify: <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />, wallet: <WalletIcon size={16} strokeWidth={1.8} aria-hidden />,
  trust: <Landmark size={16} strokeWidth={1.8} aria-hidden />, issue: <Stamp size={16} strokeWidth={1.8} aria-hidden />, audit: <ScrollText size={16} strokeWidth={1.8} aria-hidden />,
};
// Two overlapping rings: what a proof discloses is only the overlap.
const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <circle className="ring-a" cx="9.5" cy="13" r="7" stroke="currentColor" strokeWidth="1.6" /><circle className="ring-b" cx="16.5" cy="13" r="7" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const CLS: Record<string, string> = { pass: "ok", fail: "bad", quarantine: "warn", warn: "warn" };
const fmtDate = (n: string) => (n === "0" ? "-" : `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`);
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-4)}`;

export default function App() {
  const theme = useTheme();
  // Background field colours come from the site palette (page ground, dots, crest accent). Dots stay close to the ground colour so they
  // never compete with text. The array must be memoised: WaveMesh rebuilds its canvas whenever the array identity changes.
  const waveColors = useMemo<[string, string, string]>(() => (theme === "dark" ? ["#121211", "#4B4944", "#8E8A81"] : ["#E9E6E0", "#BEB8AB", "#6B675E"]), [theme]);
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [tab, setTab] = useState<Tab>(route.tab ?? "verify");
  useEffect(() => { if (route.tab) setTab(route.tab); }, [route]);
  const [pub, setPub] = useState<any>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => api("/api/public").then(setPub).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const phaseLabel = pub ? ({ normal: "Normal operation", stolen: "Key stolen (undetected)", declared: "Compromise declared" } as any)[pub.phase] : "";
  if (route.view === "landing") return <Suspense fallback={null}><Landing /></Suspense>;
  return (
    <>
    <div className="app-bg" aria-hidden="true"><WaveMesh colors={waveColors} className="h-full w-full" /></div>
    <div className="wrap">
      <header>
        <div className="brand"><a className="brandlink" href="#" aria-label="Sovereign Proof overview"><Mark /> Sovereign Proof</a></div>
        {pub && <span className="phase" data-phase={pub.phase} aria-live="polite"><i className="dot" aria-hidden="true" />Registry v{pub.registry.body.version} · {phaseLabel}</span>}
        <nav aria-label="Main">
          {([["verify", "Verify"], ["wallet", "Wallet"], ["trust", "Trust & incident"], ["issue", "Issue"], ["audit", "Audit"]] as const).map(([k, l]) => (
            <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{NAV_ICON[k]}{l}</button>
          ))}
        </nav>
        <WalletPill />
        <button type="button" className="themebtn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
          {theme === "dark" ? <Sun size={16} strokeWidth={1.8} aria-hidden /> : <Moon size={16} strokeWidth={1.8} aria-hidden />}
        </button>
        <div className="mast-rule" aria-hidden="true" />
      </header>
      {error && <p className="err" role="alert">{error}</p>}
      <main key={tab} className="page">
      {!pub ? <p className="muted">Connecting to the demo registry…</p> : tab === "verify" ? <Verify pub={pub} refresh={refresh} /> :
        tab === "wallet" ? <Wallet pub={pub} /> : tab === "trust" ? <Trust pub={pub} refresh={refresh} /> :
        tab === "issue" ? <Issue pub={pub} refresh={refresh} /> : <Audit pub={pub} refresh={refresh} />}
      </main>
    </div>
    </>
  );
}

function useWallet(profile: string, version: unknown) {
  const [w, setW] = useState<any>(null);
  useEffect(() => { api(`/api/demo/wallet/${profile}`).then(setW).catch(() => setW(null)); }, [profile, version]);
  return w;
}

function CredCard({ c, selected }: { c: WireCred; selected?: boolean }) {
  const f = c.fields;
  return (
    <div className={"cred" + (selected ? " sel" : "")}>
      <div className="t">{c.label}</div>
      <div className="muted small">Issued by {c.issuerId} · stored only in your wallet</div>
      <div className="kv">
        {c.role === "id" && (<><span>Name</span><span>{c.private?.name ?? "(hidden)"} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span><span>Home address</span><span>{c.private?.address ?? "(hidden)"} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span><span>Date of birth</span><span>{fmtDate(f.a1)} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span></>)}
        {c.role === "degree" && (<><span>Degree code</span><span>{f.a1} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span><span>Graduated</span><span>{fmtDate(f.a2)} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span></>)}
        {c.role === "license" && (<><span>License type</span><span>{f.a1} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span><span>Expires</span><span>{fmtDate(f.a2)} <em className="tag-priv"><Lock size={11} aria-hidden />private</em></span></>)}
        <span>Status slot</span><span>#{f.statusIndex} <em className="tag-pub"><Eye size={11} aria-hidden />shared with verifier</em></span>
      </div>
    </div>
  );
}

function Verify({ pub, refresh }: { pub: any; refresh: () => void }) {
  const [profile, setProfile] = useState("alice");
  const wallet = useWallet(profile, pub.phase + pub.registry.body.version + JSON.stringify(pub.revokedSlots));
  const [issuerPin, setIssuerPin] = useState("uni-x");
  const [age, setAge] = useState(21);
  const [policy, setPolicy] = useState<"reject" | "warn">("reject");
  const [req, setReq] = useState<WireRequest | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [ms, setMs] = useState(0);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const byRole = useMemo(() => {
    const m: Record<string, WireCred[]> = { id: [], degree: [], license: [] };
    (wallet?.creds ?? []).forEach((c: WireCred) => m[c.role].push(c));
    return m;
  }, [wallet]);
  const chosen = (role: string) => byRole[role][pick[role] ?? byRole[role].length - 1];

  async function createRequest() {
    setErr(""); setRes(null);
    try { setReq(await api("/api/verifier/request", { requiredDegree: pub.catalog.degrees[0].code, requiredLicense: pub.catalog.licenses[0].code, ageYears: age, requiredDegreeIssuer: issuerPin || undefined, onStatusUnavailable: policy })); }
    catch (e: any) { setErr(e.message); }
  }
  async function respond() {
    if (!req || !wallet) return;
    const [id, degree, license] = [chosen("id"), chosen("degree"), chosen("license")];
    if (!id || !degree || !license) { setErr("This wallet is missing a required credential (see Wallet tab)."); return; }
    setErr(""); setRes(null); setBusy("Generating zero-knowledge proof in your browser…");
    const t0 = performance.now(), tick = setInterval(() => setMs(performance.now() - t0), 200);
    try {
      const p = await proveInBrowser(wallet.holderSecret, id, degree, license, req);
      setBusy("Verifier is checking proof, issuer trust and revocation…");
      const out = await api("/api/verifier/verify", { requestId: req.id, proof: { proof: p.proof, publicSignals: p.publicSignals } });
      setMs(performance.now() - t0); setRes({ ...out, proofBytes: JSON.stringify(p.proof).length, requestId: req.id }); setReq(null); refresh();
    } catch (e: any) { setErr(/Assert Failed/.test(e?.message ?? "") || !e?.message ? "These credentials do not satisfy this request (for example the age, degree or license requirement is not met), so no proof can be generated." : e.message); }
    finally { clearInterval(tick); setBusy(""); }
  }
  const degLabel = pub.catalog.degrees[0].label, licLabel = pub.catalog.licenses[0].label;
  return (
    <>
      <h1>Prove it without <em>exposing it</em></h1>
      <p className="lead">An employer needs three facts at once. The holder proves all three with a single zero-knowledge proof, so the employer never sees a name, birth date, address or transcript.</p>
      <div className="grid g2">
        <section className="card" aria-labelledby="v-h">
          <h2 id="v-h">1 · Verifier (employer) policy</h2>
          <label htmlFor="deg">Required degree</label>
          <select id="deg" disabled><option>{degLabel}</option></select>
          <label htmlFor="pin">Degree must be issued by</label>
          <select id="pin" value={issuerPin} onChange={(e) => setIssuerPin(e.target.value)}>
            <option value="uni-x">Northfield University</option><option value="">Any trusted university</option>
          </select>
          <label htmlFor="age">Applicant must be older than</label>
          <input id="age" type="number" min={1} max={99} value={age} onChange={(e) => setAge(Number(e.target.value))} />
          <label htmlFor="lic">Required license</label>
          <select id="lic" disabled><option>{licLabel}</option></select>
          <label htmlFor="pol">If the revocation service is unreachable</label>
          <select id="pol" value={policy} onChange={(e) => setPolicy(e.target.value as any)}><option value="reject">Reject (fail closed)</option><option value="warn">Warn and continue</option></select>
          <div className="row mt"><button className="btn" onClick={createRequest} disabled={!!busy}>Create verification request</button></div>
          {req && <p className="small mt">Request <span className="mono">{short(req.id)}</span> issued. Single-use challenge, valid for 5 minutes. The policy is stored by the verifier, so the holder cannot weaken it.</p>}
        </section>
        <section className="card" aria-labelledby="h-h">
          <h2 id="h-h">2 · Holder wallet</h2>
          <label htmlFor="prof">Wallet</label>
          <select id="prof" value={profile} onChange={(e) => { setProfile(e.target.value); setPick({}); setRes(null); }}>
            <option value="alice">Alice (legitimate holder)</option><option value="mallory">Mallory (fake degree from stolen key)</option>
          </select>
          {(["id", "degree", "license"] as const).filter((r) => byRole[r].length > 1).map((r) => (
            <div key={r}><label htmlFor={"pick-" + r}>Which {r} credential to present</label>
              <select id={"pick-" + r} value={pick[r] ?? byRole[r].length - 1} onChange={(e) => setPick({ ...pick, [r]: Number(e.target.value) })}>
                {byRole[r].map((d, i) => <option key={i} value={i}>{d.label}</option>)}
              </select></div>))}
          <div className="mt cols">
            <div><h3>Proved, not disclosed</h3><ul className="clean small"><li>Holds the {degLabel}</li><li>Older than {req?.ageYears ?? age}</li><li>{licLabel} active today</li><li>All three belong to the same person</li></ul></div>
            <div><h3>Never leaves this device</h3><ul className="clean small"><li>Name, home address, date of birth</li><li>Graduation date, license expiry</li><li>Holder secret and signatures</li></ul></div>
          </div>
          <p className="small muted mt">The verifier will learn: which issuers signed (by key), each credential's revocation slot, and which notarized log the credential is in.</p>
          <div className="row mt">
            <button className="btn" onClick={respond} disabled={!req || !!busy || !wallet}>Generate proof &amp; send</button>
            {!req && <span className="small muted">Create a request first</span>}
          </div>
          {busy && <p className="small mt" role="status"><span className="spin" />{busy} {(ms / 1000).toFixed(1)}s</p>}
          {err && <p className="err" role="alert">{err}</p>}
        </section>
      </div>
      {res && <Result res={res} ms={ms} refresh={refresh} />}
    </>
  );
}

function Result({ res, ms, refresh }: { res: any; ms: number; refresh: () => void }) {
  const head = { accepted: [<Check size={26} strokeWidth={2.2} />, "Verified", "All requirements proven; issuers trusted; nothing revoked."], quarantined: [<TriangleAlert size={24} strokeWidth={2} />, "Quarantined", "Cryptographically valid, but trust cannot be established under the incident policy."], rejected: [<X size={26} strokeWidth={2.2} />, "Rejected", "At least one requirement failed."] }[res.verdict as "accepted"];
  return (
    <section className="mt" aria-live="polite">
      <div className={"verdict v-" + res.verdict}>
        <span className="big" aria-hidden>{head[0]}</span>
        <div><div className="big">{head[1]}</div><div className="small muted">{head[2]} Audit id <span className="mono">{res.auditId}</span> · total {(ms / 1000).toFixed(1)}s incl. proving · proof ≈ {(res.proofBytes / 1024).toFixed(1)} KB</div></div>
      </div>
      <AnchorReceipt res={res} refresh={refresh} />
      <div className="grid g2">
        <div className="card"><h2>Why: step by step</h2>
          <ol className="steps">{res.steps.map((s: any) => (
            <li key={s.id}><span className={"ico " + CLS[s.outcome]} aria-label={s.outcome}>{ICON[s.outcome]}</span>
              <div><div><strong>{s.label}</strong></div><div className="small muted">{s.detail}</div></div></li>))}</ol>
        </div>
        <div className="card"><h2>What the verifier learned</h2>
          <table><tbody>{res.disclosed.issuers.map((i: any) => (<tr key={i.role}><td>{i.role}</td><td>signed by <strong>{i.issuerId ?? "unknown key"}</strong><div className="mono muted">{short(i.keyId)}</div></td></tr>))}</tbody></table>
          <h3 className="mt">Stayed private</h3>
          <ul className="clean small">{res.hidden.map((h: string) => <li key={h}>{h}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

/** Lets the verifier record this outcome on the chain from their own wallet (the wallet pays the gas). Only a hash goes on-chain. */
function AnchorReceipt({ res, refresh }: { res: any; refresh: () => void }) {
  const w = useWalletState();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState<any>(null);
  useEffect(() => { setDone(null); setErr(""); }, [res.auditId]);
  async function go() {
    setErr(""); setBusy(true);
    try {
      if (!getWallet().account) await connect();
      if (!getWallet().account) throw new Error(getWallet().error || "Connect a wallet to anchor the receipt.");
      const { sha256, toUtf8Bytes } = await import("ethers");
      const hash = sha256(toUtf8Bytes(receiptText({ auditId: res.auditId, verdict: res.verdict, steps: res.steps, registryVersion: res.registryVersion }))).slice(2);
      const out = await anchorReceipt(hash, res.registryVersion, res.verdict === "accepted");
      setDone({ ...out, hash }); await refresh();
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card receipt">
      <div className="row">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ marginBottom: 4 }}>Anchor this result from your wallet</h2>
          <p className="small muted" style={{ margin: 0 }}>Records a hash of this outcome on the chain under your address, with the block time. No credential data goes on-chain. It costs a small gas fee, paid from the wallet{w.info?.local ? " (free test ETH on this local chain)" : ""}.</p>
        </div>
        <button type="button" className="btn small" disabled={busy || !!done} onClick={go}>{busy ? "Confirm in your wallet…" : done ? "Anchored" : w.account ? `Anchor as ${shortAddr(w.account)}` : "Connect wallet and anchor"}</button>
      </div>
      {err && <p className="err small" role="alert" style={{ marginBottom: 0 }}>{err}</p>}
      {done && (
        <div className="kv small mt">
          <span>Receipt hash</span><span className="mono">{short(done.hash)}</span>
          <span>Transaction</span><span className="mono">{short(done.txHash)}</span>
          <span>Block</span><span className="mono">#{done.block}</span>
          <span>Gas</span><span>{Number(done.gasUsed).toLocaleString()} units · fee {Number(done.costEth).toFixed(6)} {w.info?.symbol ?? "ETH"}</span>
          {done.rejected && <><span>Refused</span><span className="bad">{done.rejected}</span></>}
        </div>
      )}
    </div>
  );
}

function Wallet({ pub }: { pub: any }) {
  const [profile, setProfile] = useState("alice");
  const w = useWallet(profile, pub.phase);
  return (
    <>
      <h1>Holder <em>wallet</em></h1>
      <p className="lead">Credentials live with the holder, not in any institution's database. This view is private to the holder; none of the attribute values below are ever sent to a verifier.</p>
      <label htmlFor="wp">Wallet</label>
      <select id="wp" value={profile} onChange={(e) => setProfile(e.target.value)} style={{ maxWidth: 360 }}>
        <option value="alice">Alice</option><option value="mallory">Mallory</option>
      </select>
      <div className="grid g3 mt">{w?.creds.map((c: WireCred, i: number) => <CredCard key={i} c={c} />)}</div>
      <p className="small muted mt">Demo note: holder secrets are held by the demo server only so the walkthrough is reproducible. In a real wallet the secret is generated and kept on the holder's device.</p>
    </>
  );
}

function Trust({ pub, refresh }: { pub: any; refresh: () => void }) {
  const [err, setErr] = useState("");
  const act = (path: string, body?: unknown) => async () => { setErr(""); try { await (ROUTE_ROLE[path] ? signedPost(path, body ?? {}, ROUTE_ROLE[path]) : api(path, body ?? {})); await refresh(); } catch (e: any) { setErr(e.message); } };
  const s = pub.summary;
  const badge = (st: string) => <span className={"badge " + (st === "active" ? "b-ok" : st === "compromised" ? "b-warn" : "b-bad")}>{st}</span>;
  return (
    <>
      <h1>Trust registry &amp; <em>key-compromise incident</em></h1>
      <p className="lead">Simulate the 48-hour university key theft and watch the trust decisions change. Run the same verification before and after on the Verify tab.</p>
      <ActingAs />
      <div className="card"><h2>Incident controls</h2>
        <div className="row">
          <button className="btn" disabled={pub.phase !== "normal"} onClick={act("/api/demo/steal")}>1 · Thief issues a fake degree</button>
          <button className="btn danger" disabled={pub.phase === "declared"} onClick={act("/api/demo/declare")}>2 · Declare key compromise</button>
          <button className="btn ghost" disabled={pub.phase !== "declared"} onClick={act("/api/demo/reissue", { profile: "alice" })}>3 · University re-issues Alice's degree (epoch 2)</button>
          <button className="btn ghost" onClick={act("/api/demo/revoke-license", { profile: "alice" })}>Revoke Alice's license</button>
          <button className="btn ghost" onClick={act("/api/demo/outage", { on: !pub.outage })}>{pub.outage ? "Restore" : "Take down"} status service</button>
          <button className="btn ghost" onClick={act("/api/demo/chain-outage", { on: !pub.chain?.simulatedOutage })}>{pub.chain?.simulatedOutage ? "Restore" : "Take down"} chain</button>
          <button className="btn ghost" onClick={act("/api/demo/reset")}>Reset demo</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
      <ChainPanel chain={pub.chain} anchors={pub.anchors} receipts={pub.receipts ?? []} />
      <div className="grid g2 mt">
        <div className="card"><h2>Issuer keys (registry v{pub.registry.body.version})</h2>
          <div className="tablewrap"><table><thead><tr><th>Issuer</th><th>Epoch</th><th>Status</th><th>Key id</th></tr></thead>
            <tbody>{pub.keyStatus.map((k: any) => (<tr key={k.keyId}><td>{k.issuerId}</td><td>{k.epoch}</td><td>{badge(k.status)}</td><td className="mono">{short(k.keyId)}</td></tr>))}</tbody></table></div>
          <p className="small muted mt">Registry versions are hash-chained and signed by the registry admin key. Verifiers pin the newest version they accepted and refuse rollbacks.</p>
          <h3>Version history</h3>
          <div className="small">{pub.history.map((h: any) => <div key={h.version}>v{h.version} · <span className="mono">{short(h.hash)}</span> {h.note && <span className="muted">· {h.note}</span>}</div>)}</div>
        </div>
        <div className="card"><h2>Recovery policy</h2>
          <ul className="clean small">
            <li>A valid signature is <strong>not</strong> proof of legitimate issuance.</li>
            <li>Credentials from the compromised key are accepted only if their issuance-log root was timestamped by the blockchain <strong>before</strong> the compromise window opened.</li>
            <li>Credentials without such evidence are <strong>quarantined</strong>, not silently accepted or deleted. The university can re-attest them under the new key.</li>
            <li>Other issuers are unaffected. No holder identities are published.</li>
          </ul>
          {s ? (<div className="mt"><h3>Incident summary (counts only)</h3>
            <div className="kv"><span>Trusted anchors</span><span>{s.trustedAnchors}</span><span>Suspect anchors</span><span>{s.suspectAnchors}</span><span>Legacy entries protected</span><span>{s.legacyCredentialsProtected}</span><span>Last trusted anchor</span><span className="mono">{s.lastTrustedAnchor}</span></div></div>)
            : <p className="small muted mt">No incident declared.</p>}
        </div>
      </div>
      <div className="card mt"><h2>On-chain issuance anchors</h2>
        <div className="tablewrap"><table><thead><tr><th>Issuer key</th><th>Entries</th><th>Block time (set by the chain)</th><th>Block</th><th>Transaction</th><th>Root</th></tr></thead>
          <tbody>{pub.anchors.map((a: any, i: number) => (<tr key={i}><td className="mono">{short(a.issuerKeyId)}</td><td>{a.leafCount}</td><td className="mono">{a.anchoredAt}</td><td className="mono">#{a.chain?.blockNumber}</td><td className="mono">{a.chain ? short(a.chain.txHash) : "-"}</td><td className="mono">{short(a.root)}</td></tr>))}</tbody></table></div>
      </div>
      <div className="card mt"><h2>Event log</h2><div className="timeline">{pub.events.map((e: any, i: number) => <div key={i}>{e.t.slice(11, 19)} · {e.type} · {e.detail}</div>)}</div></div>
    </>
  );
}

function Issue({ pub, refresh }: { pub: any; refresh: () => void }) {
  const [profile, setProfile] = useState("alice");
  const w = useWallet(profile, pub.phase);
  const [issuerId, setIssuerId] = useState("uni-x");
  const DEFAULTS: Record<number, [string, string]> = { 1: ["19900101", "0"], 2: ["555", "20240601"], 3: ["77", "20300101"] };
  const [pname, setPname] = useState("Alice Verma"); const [paddr, setPaddr] = useState("12 Harbor Lane, Northfield");
  const [a1, setA1] = useState("555"); const [a2, setA2] = useState("20240601");
  const [out, setOut] = useState<any>(null); const [err, setErr] = useState("");
  const issuer = pub.registry.body.issuers.find((i: any) => i.issuerId === issuerId);
  const type = issuer.credTypes[0], role = type === 1 ? "id" : type === 2 ? "degree" : "license";
  async function go() {
    setErr(""); setOut(null);
    try { setOut(await signedPost("/api/issue", { issuerId, type, profile, holderId: w.creds[0].fields.holderId, a1, a2: type === 1 ? "0" : a2, name: pname, address: paddr, label: `${({ id: "National ID", degree: "Degree", license: "License" } as any)[role]} (issued ${new Date().toLocaleTimeString()})` }, issuerId as any)); await refresh(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <>
      <h1>Issue a <em>credential</em></h1>
      <p className="lead">The issuer signs a salted commitment to the claims, logs the commitment, and the notary timestamps the log. The issuer receives only the holder's pseudonymous id, never the holder secret.</p>
      <ActingAs />
      <div className="grid g2"><div className="card">
        <label htmlFor="is">Issuer</label>
        <select id="is" value={issuerId} onChange={(e) => {
          const t = pub.registry.body.issuers.find((i: any) => i.issuerId === e.target.value).credTypes[0];
          setIssuerId(e.target.value); setOut(null); setErr(""); setA1(DEFAULTS[t][0]); setA2(DEFAULTS[t][1]);
        }}>
          {pub.registry.body.issuers.map((i: any) => <option key={i.issuerId} value={i.issuerId}>{i.name} ({i.issuerId})</option>)}
        </select>
        <label htmlFor="who">Holder</label>
        <select id="who" value={profile} onChange={(e) => setProfile(e.target.value)}><option value="alice">Alice</option><option value="mallory">Mallory</option></select>
        <label htmlFor="a1">{type === 1 ? "Date of birth (YYYYMMDD)" : type === 2 ? "Degree code" : "License type code"}</label>
        <input id="a1" value={a1} onChange={(e) => setA1(e.target.value)} inputMode="numeric" />
        {type === 1 && (<><label htmlFor="nm">Full name</label><input id="nm" value={pname} onChange={(e) => setPname(e.target.value)} maxLength={80} />
          <label htmlFor="ad">Home address</label><input id="ad" value={paddr} onChange={(e) => setPaddr(e.target.value)} maxLength={80} />
          <p className="small muted">The issuer signs a hash of name and address together with the birth date. Verifiers never receive either value, and neither is ever an input to a proof.</p></>)}
        {type !== 1 && (<><label htmlFor="a2">{type === 2 ? "Graduation date (YYYYMMDD)" : "Expiry date (YYYYMMDD)"}</label><input id="a2" value={a2} onChange={(e) => setA2(e.target.value)} inputMode="numeric" /></>)}
        <div className="row mt"><button className="btn" onClick={go} disabled={!w}>Sign &amp; issue</button></div>
        {err && <p className="err" role="alert">{err}</p>}
        {pub.phase === "stolen" && <p className="small warn mt">The compromise has not been declared yet. A genuine issuance now is timestamped inside the theft window, so the recovery policy would quarantine it until re-attested.</p>}
      </div>
      <div className="card"><h2>Result</h2>{out ? <CredCard c={out} /> : <p className="muted small">Nothing issued yet.</p>}
        {out && <p className="small muted">Added to the issuer's log, timestamped by the notary, and stored in {profile === "alice" ? "Alice" : "Mallory"}'s wallet (see the Wallet tab). If it is a second credential of a type the wallet already holds, choose it in the Verify tab's credential picker.</p>}</div></div>
    </>
  );
}

function Audit({ pub, refresh }: { pub: any; refresh: () => void }) {
  return (
    <>
      <h1>Security &amp; <em>audit</em></h1>
      <p className="lead">Every change to the trust data is written to the chain with who made it, when, and the previous value. Refused attempts are recorded too. Each verification also leaves one record of public material only: a verdict, per-step outcomes and issuer ids.</p>
      <ActingAs />
      <WalletGuide pub={pub} />
      <ChangeHistory pub={pub} refresh={refresh} />
      <div className="grid g2 mt">
        <div className="card"><h2>Verification log</h2>
          {pub.audit.length === 0 ? <p className="muted small">No verifications yet.</p> : (
            <div className="tablewrap"><table><thead><tr><th>Time</th><th>Id</th><th>Verdict</th><th>Issuers</th></tr></thead>
              <tbody>{[...pub.audit].reverse().map((a: any) => (<tr key={a.auditId + a.t}><td className="mono">{a.t.slice(11, 19)}</td><td className="mono">{a.auditId}</td>
                <td><span className={"badge " + (a.verdict === "accepted" ? "b-ok" : a.verdict === "quarantined" ? "b-warn" : "b-bad")}>{a.verdict}</span></td><td className="small">{a.issuers.join(", ")}</td></tr>))}</tbody></table></div>)}
        </div>
        <div className="card"><h2>Trust model and honest limits</h2>
          <ul className="clean small">
            <li><strong>Real:</strong> Groth16 proofs over the BN254 curve; EdDSA-Poseidon issuer signatures verified inside the circuit; Poseidon Merkle issuance logs; an Ed25519-signed, hash-chained registry; and a Solidity smart contract on an EVM chain that records registry hashes and issuance-log roots.</li>
            <li><strong>Simulated:</strong> issuers and key custody run in one demo server, and the blockchain is a local development chain (Hardhat), not a public network. Its clock is steered to replay the demo timeline.</li>
            <li><strong>Centralized:</strong> registry and status-list hosting, and the one local chain node. Registry versions are signed and their hashes are on the chain, so tampering is detectable, but the demo itself is not a decentralized network.</li>
            <li><strong>Dev-only:</strong> the trusted setup has a single local contribution. A real deployment needs a multi-party ceremony.</li>
            <li><strong>Attribution:</strong> every write made through the application must be signed by an authorised account, and is recorded with who, when and the previous value; refused attempts are recorded too, and the access log is anchored on the chain so it cannot be quietly rewritten. An edit that <em>bypasses</em> the application (raw file or database access) cannot carry a signature by definition: the system detects it, shows what changed against the chain, proves no authorised signed write explains it, and bounds it in time by the last intact anchor. Naming the person behind such a raw edit would still need host-level logging. Verifiers are unaffected, because they check the chain, not the server's copy.</li>
            <li><strong>Demo shortcuts:</strong> actors sign with the local node's publicly known test keys, and the server relays each transaction from the node's unlocked accounts after checking the actor's signature. In production every actor holds its own key and submits its own transactions, which removes that trust in the server.</li>
            <li><strong>Leaks by design:</strong> issuer identity, revocation slot index and which notarized log root. Whole status lists are downloaded, so issuers do not learn which credential was checked.</li>
          </ul></div>
      </div>
    </>
  );
}

function ChainPanel({ chain, anchors, receipts }: { chain: any; anchors: any[]; receipts: any[] }) {
  if (!chain) return null;
  const online = chain.ok;
  return (
    <div className="grid g2 mt">
      <div className="card"><h2>Blockchain</h2>
        <div className="row small" style={{ marginBottom: 12 }}>
          <span className={"badge " + (online ? "b-ok" : "b-bad")}>{online ? "online" : "offline"}</span>
          <span className="muted">{chain.network}</span>
        </div>
        {online ? (
          <>
            <div className="kv"><span>Contract</span><span>{chain.contract.slice(0, 10)}…{chain.contract.slice(-6)}</span><span>Latest block</span><span>#{chain.blockNumber}</span><span>Block time</span><span>{chain.blockTime}</span><span>Anchors recorded</span><span>{anchors.length}</span></div>
            <h3 className="mt">Registry versions on the chain</h3>
            <div className="tablewrap"><table><thead><tr><th>Ver</th><th>Hash</th><th>Block</th><th>Transaction</th></tr></thead>
              <tbody>{chain.registry.map((r: any) => (<tr key={r.version}><td>v{r.version}</td><td className="mono">{short(r.hash)}</td><td className="mono">#{r.blockNumber}</td><td className="mono">{r.txHash ? short(r.txHash) : "-"}</td></tr>))}</tbody></table></div>
            <h3 className="mt">Verification receipts from wallets</h3>
            {receipts.length === 0 ? <p className="small muted" style={{ margin: 0 }}>None yet. Run a verification, then use "Anchor this result from your wallet".</p> : (
              <div className="tablewrap"><table><thead><tr><th>Wallet</th><th>Result</th><th>Block</th><th>Audit record</th></tr></thead>
                <tbody>{receipts.slice().reverse().map((x: any) => (<tr key={x.receipt}><td><span className="mono">{short(x.verifier)}</span><div className="small muted">{x.verifierLabel}</div></td>
                  <td>{x.accepted ? "accepted" : "not accepted"}<div className="small muted">registry v{x.registryVersion}</div></td><td className="mono">#{x.blockNumber}</td>
                  <td><span className={"badge " + (x.matchesAudit ? "b-ok" : "b-warn")}>{x.matchesAudit ? "matches" : "no match"}</span></td></tr>))}</tbody></table></div>
            )}
          </>
        ) : (
          <p className="err" role="alert" style={{ marginTop: 0 }}>{chain.error ?? "chain unreachable"}. Verifiers fail closed: with no public record to check, nothing is accepted.{chain.simulatedOutage ? "" : " Start the node with npm run chain, then press Reset demo."}</p>
        )}
      </div>
      <div className="card"><h2>What the chain does here</h2>
        <ul className="clean small">
          <li><strong>Timestamps nobody can edit.</strong> A university's service account posts the Merkle root of its credential log. The block time is the evidence that a credential existed before a key was stolen, and a thief holding the key cannot backdate it.</li>
          <li><strong>A public, append-only registry history.</strong> Every registry version's hash is recorded, each naming the one before it. A rolled-back or forked registry is rejected even if it carries a valid signature.</li>
          <li><strong>Only hashes go on-chain.</strong> No credentials, names, birth dates or proofs. Privacy comes from the zero-knowledge proof, not from the chain.</li>
          <li><strong>Fails closed.</strong> If the chain cannot be read, a verifier accepts nothing.</li>
        </ul>
      </div>
    </div>
  );
}

const clip = (v: string, n = 70) => (v.length > n ? v.slice(0, n) + "…" : v);

function ChangeHistory({ pub, refresh }: { pub: any; refresh: () => void }) {
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const audit: any[] = pub.chain?.audit ?? [];
  const check = useCallback(async () => { setErr(""); try { setReport(await api("/api/integrity")); } catch (e: any) { setErr(e.message); } }, []);
  const run = (label: string, path: string, then: "check" | "none" = "check") => async () => {
    setErr(""); setBusy(label);
    try { await (ROUTE_ROLE[path] ? signedPost(path, {}, ROUTE_ROLE[path]) : api(path, {})); await refresh(); if (then === "check") await check(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  };
  return (
    <>
      <div className="card"><h2>Change history, from the chain</h2>
        {!pub.chain?.ok ? <p className="err" role="alert" style={{ marginTop: 0 }}>The chain cannot be read, so there is no trustworthy history to show. {pub.chain?.error}</p> : audit.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>When (block time)</th><th>Who</th><th>What</th><th>Previous → new</th><th>Block · tx</th></tr></thead>
            <tbody>{audit.map((e) => (
              <tr key={e.id} className={e.kind === "rejected" ? "row-rejected" : undefined}>
                <td className="mono">{e.time.slice(0, 19).replace("T", " ")}</td>
                <td><div>{e.actorLabel}</div><div className="mono muted">{short(e.actor)}</div></td>
                <td>{e.kind === "rejected" && <span className="badge b-bad" style={{ marginRight: 6 }}>refused</span>}{e.action}{e.targetLabel && <div className="small muted">{e.targetLabel}</div>}{e.note && <div className="small muted">{e.note}</div>}</td>
                <td className="small">{e.changes?.length ? e.changes.slice(0, 4).map((c: any, i: number) => <div key={i}><span className="muted">{c.path}</span> <span className="mono">{clip(c.from, 28)}</span> → <span className="mono">{clip(c.to, 28)}</span></div>) :
                  e.kind === "rejected" ? <span className="muted">no change was made</span> : e.action.startsWith("Anchoring account") ? <span>{e.previous ?? "(none)"} → {e.next}</span> : e.previous || e.next ? <span className="mono">{e.previous ? short(e.previous) : "(none)"} → {e.next ? short(e.next) : "-"}</span> : "-"}
                  {e.changes?.length > 4 && <div className="muted">+{e.changes.length - 4} more</div>}</td>
                <td className="mono">#{e.blockNumber}<div className="muted">{short(e.txHash)}</div></td>
              </tr>))}</tbody></table></div>)}
        <p className="small muted mt">Only hashes and short public notes are on the chain. The readable "previous → new" is shown only when the archived copy re-hashes to exactly what the chain recorded.</p>
      </div>
      <div className="grid g2 mt">
        <div className="card"><h2>Try to break it</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Each action is something an attacker might do. Then see what the system recorded or detected.</p>
          <div className="row">
            <button className="btn ghost small" disabled={!!busy} onClick={async () => {
              setErr(""); setBusy("attempt");
              try {
                await api("/api/demo/attempt-unauthorised", {}); // writes straight to the chain from an unknown account
                // ...and the API: unsigned, a stranger's key, and a real account acting outside its role. Each must be refused and logged.
                await signedPost("/api/demo/declare", {}, null, true).catch(() => undefined);
                await signedPost("/api/demo/declare", {}, "stranger", true).catch(() => undefined);
                await signedPost("/api/demo/declare", {}, "med-board", true).catch(() => undefined);
                await refresh();
              } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
            }}>Outsider tries to change data</button>
            <button className="btn ghost small" disabled={!!busy} onClick={run("tamper", "/api/demo/tamper-registry")}>Edit the stored registry</button>
            <button className="btn ghost small" disabled={!!busy} onClick={run("replay", "/api/demo/rollback-status")}>Replay an old revocation list</button>
            <button className="btn ghost small" disabled={!!busy} onClick={run("log", "/api/demo/tamper-log", "none")}>Rewrite an access-log entry</button>
            <button className="btn ghost small" disabled={!!busy} onClick={run("restore", "/api/demo/restore")}>Restore from the chain</button>
          </div>
          <p className="small muted mt">Replaying a list needs a revocation to exist first (Trust tab → Revoke Alice's license). Restore is itself a signed action by the registry admin. Verify tab → generate a proof afterwards to see the verifier refuse tampered data.</p>
          {err && <p className="err" role="alert">{err}</p>}
        </div>
        <div className="card"><h2>Integrity check</h2>
          <div className="row"><button className="btn small" onClick={check} disabled={!!busy}>Compare served data with the chain</button>
            {report && report.ok !== false && <span className={"badge " + (report.clean ? "b-ok" : "b-bad")}>{report.clean ? "clean" : "problems found"}</span>}</div>
          {report?.ok === false && <p className="err" role="alert">{report.error}</p>}
          {report?.findings && <ul className="clean small mt" style={{ listStyle: "none", paddingLeft: 0 }}>{report.findings.map((f: any, i: number) => (
            <li key={i} style={{ margin: "10px 0" }}>
              <span className={f.ok ? "ok" : "bad"}>{f.ok ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}</span> <strong>{f.subject}</strong>: {f.summary}
              {f.chain && <div className="muted">chain: {f.chain.by}, {String(f.chain.at).slice(0, 19).replace("T", " ")}{f.chain.block !== undefined && <> · block #{f.chain.block}</>}</div>}
              {f.changes?.map((c: any, j: number) => <div key={j} className="mono" style={{ marginLeft: 12 }}>{c.path}: {clip(c.from, 36)} → {clip(c.to, 36)}</div>)}
              {f.previous && <div className="muted">{f.previous}</div>}
              {f.forensics?.length > 0 && <div className="small" style={{ marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--line-strong)" }}>{f.forensics.map((x: string, j: number) => <div key={j}>{x}</div>)}</div>}
            </li>))}</ul>}
        </div>
      </div>
      <AccessLogPanel pub={pub} />
    </>
  );
}

function AccessLogPanel({ pub }: { pub: any }) {
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState("");
  const log: any[] = pub.accessLog ?? [];
  const heads = new Map<number, any>((pub.chain?.auditHeads ?? []).map((h: any) => [h.seq, h]));
  const verify = async () => { setErr(""); try { setReport(await api("/api/access-log/verify")); } catch (e: any) { setErr(e.message); } };
  const tone = (o: string) => (o === "ok" ? "b-ok" : o === "denied" ? "b-bad" : "b-warn");
  return (
    <div className="card mt"><h2>Access log</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Every write attempt, accepted or refused, is an entry that includes the hash of the one before it. After each entry the server anchors the log's head on the chain, so history cannot be rewritten without contradicting a record nobody on the server can edit. Privileged actions must be signed by an authorised account; the signer is recovered from the signature, never taken from the request.</p>
      <div className="row"><button className="btn small" onClick={verify}>Verify the log against the chain</button>
        {report && !report.error && <span className={"badge " + (report.ok ? "b-ok" : "b-bad")}>{report.ok ? `intact · ${report.entries} entries, ${report.anchored} anchored` : "tampering detected"}</span>}</div>
      {err && <p className="err" role="alert">{err}</p>}
      {report?.error && <p className="err" role="alert">{report.error}</p>}
      {report && report.ok === false && !report.error && (
        <div className="small mt">
          {report.problems.map((p: any, i: number) => (
            <div key={i} style={{ margin: "8px 0" }}><span className="bad"><X size={13} aria-hidden /></span> <strong>Entry #{p.seq}</strong>: {p.detail}.
              {p.anchor && <span className="muted"> Anchored in block #{p.anchor.block} at {p.anchor.time.slice(0, 19).replace("T", " ")} (tx {short(p.anchor.tx)}).</span>}</div>))}
          <div className="muted">First altered entry: #{report.firstBad}. {report.lastGoodAnchor ? `Last entry proven intact: #${report.lastGoodAnchor.seq}, anchored in block #${report.lastGoodAnchor.block} at ${report.lastGoodAnchor.time.slice(0, 19).replace("T", " ")}. The tampering happened after that moment.` : "No earlier entry could be proven intact."}</div>
        </div>)}
      <div className="tablewrap mt"><table>
        <thead><tr><th>#</th><th>Server time</th><th>Who</th><th>What</th><th>Result</th><th>Anchored</th></tr></thead>
        <tbody>{log.map((e) => (
          <tr key={e.seq} className={e.outcome === "denied" ? "row-rejected" : undefined}>
            <td className="mono">{e.seq}</td><td className="mono">{e.time.slice(11, 19)}</td>
            <td><div>{e.actorLabel}</div>{e.actor !== "-" && <div className="mono muted">{short(e.actor)}</div>}</td>
            <td className="small">{e.detail}</td>
            <td><span className={"badge " + tone(e.outcome)}>{e.outcome === "ok" ? "accepted" : e.outcome}</span></td>
            <td className="mono">{heads.get(e.seq) ? `#${heads.get(e.seq).blockNumber}` : "-"}</td>
          </tr>))}</tbody></table></div>
      <p className="small muted mt">Server time is the real clock; block numbers belong to the demo chain, whose clock is simulated.</p>
    </div>
  );
}
