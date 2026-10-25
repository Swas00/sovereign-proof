import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Wallet } from "lucide-react";
import { DEMO_KEYS } from "../../../../packages/core/signing";
import { connect, disconnect, ensureNetwork, getTestEth, isTestChain, roleOf, setSignWith, shortAddr, useWalletState } from "../wallet";

/** Header control for the browser wallet (MetaMask): connect, see the role and balance, get free test ETH, choose what signs. */
export default function WalletPill() {
  const w = useWalletState();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  // The pill can sit anywhere in the header (it wraps), so keep the panel inside the viewport with a 16px margin.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const el = panel.current; if (!el) return;
      el.style.transform = "none";
      const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      setDx(r.left < 16 ? 16 - r.left : r.right > vw - 16 ? vw - 16 - r.right : 0);
    };
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, w.account, w.error, w.balance]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const role = roleOf(w.account, w.info);
  const onNet = !w.info || w.chainId === w.info.chainId;
  const onTest = isTestChain(w.chainId);
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => undefined); };

  return (
    <div className="walletbox" ref={box}>
      <button type="button" className={"walletpill" + (w.account && w.signWith === "wallet" ? " on" : "")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        title={w.account ? "Wallet connected" : "Connect a wallet"}>
        <Wallet size={15} strokeWidth={1.8} aria-hidden />
        <span className="wp-label">{w.account ? shortAddr(w.account) : "Connect"}</span>
        {w.account && onTest && <span className="wp-test">test</span>}
        {w.account && <i className={"wp-dot" + (onNet ? "" : " warn")} aria-hidden />}
      </button>
      {open && (
        <div className="walletpanel" role="dialog" aria-label="Wallet" ref={panel} style={dx ? { transform: `translateX(${dx}px)` } : undefined}>
          {!w.account ? (
            <>
              <h3>Use your own wallet</h3>
              <p className="small muted">A wallet such as MetaMask is free to create and keeps your key on your device. Connected, every action you take is signed by your address, so it shows in the audit trail as you. Anchoring a verification receipt on the chain costs a small gas fee, paid from the wallet.</p>
              {w.installed
                ? <button type="button" className="btn small" disabled={w.busy === "connect"} onClick={connect}>{w.busy === "connect" ? "Waiting for the wallet…" : "Connect MetaMask"}</button>
                : <p className="small">No wallet found in this browser. <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask (free)</a>, create a wallet, then reload.</p>}
              <p className="small muted" style={{ marginBottom: 0 }}>Until then, actions are signed with the built-in demo role keys.</p>
            </>
          ) : (
            <>
              <h3>Wallet connected</h3>
              {onTest
                ? <p className="wp-safe" role="status"><strong>Test network. No real money.</strong> This chain runs on your computer, and its ETH has no value. The app sends transactions only here.</p>
                : <p className="wp-unsafe" role="alert"><strong>Not the test network (id {w.chainId ?? "unknown"}).</strong> The app will not send any transaction on this network. Use Switch below to return to the local test chain.{role && " This account's key is public: never use it on a real network, anything sent to it will be stolen."}</p>}
              <div className="wp-addr mono" title={w.account}>{w.account}</div>
              <div className="kv small">
                <span>Role</span><span>{role ? <strong>{role.label}</strong> : <span className="warn">No role. Privileged actions will be refused and logged.</span>}</span>
                <span>Network</span><span>{onNet ? (w.info?.name ?? "chain") : <><span className="bad">wrong network</span> <button type="button" className="btn ghost small" onClick={() => void ensureNetwork().catch(() => undefined)}>Switch</button></>}</span>
                <span>Balance</span><span>{w.balance ?? "-"} {onTest ? "test ETH" : (w.info?.symbol ?? "ETH")}</span>
              </div>
              {w.info?.faucet && <button type="button" className="btn ghost small" disabled={w.busy === "fund"} onClick={getTestEth}>{w.busy === "fund" ? "Sending…" : "Get free test ETH"}</button>}
              <div className="wp-seg" role="group" aria-label="Sign actions with">
                <button type="button" aria-pressed={w.signWith === "wallet"} onClick={() => setSignWith("wallet")}>My wallet</button>
                <button type="button" aria-pressed={w.signWith === "demo"} onClick={() => setSignWith("demo")}>Demo keys</button>
              </div>
              <p className="small muted">{w.signWith === "wallet" ? "Buttons that need authority (declare, issue, revoke, restore) are signed by your wallet. Without a role they are refused, and the attempt is recorded under your address." : "Authority buttons are signed by the built-in role keys, so the whole demo works without wallet prompts."}</p>
              <details className="small">
                <summary><KeyRound size={13} aria-hidden /> Act as a demo role in MetaMask</summary>
                <p className="muted">These are the local chain's public test keys. Import one into MetaMask (Account menu, Import account) to hold that role with your own wallet. Never use them on a real network.</p>
                <ul className="clean">
                  {w.info?.roles.map((r) => (
                    <li key={r.role} className="wp-role"><span><strong>{r.role}</strong> <span className="muted mono">{shortAddr(r.address)}</span></span>
                      {DEMO_KEYS[r.role]
                        ? <button type="button" className="btn ghost small" onClick={() => copy(r.role, DEMO_KEYS[r.role])}>{copied === r.role ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{copied === r.role ? "Copied" : "Copy key"}</button>
                        : <span className="small muted">server only</span>}</li>
                  ))}
                </ul>
              </details>
              <button type="button" className="btn ghost small" onClick={() => { disconnect(); setOpen(false); }}>Stop using wallet</button>
            </>
          )}
          {w.error && <p className="err small" role="alert" style={{ marginBottom: 0 }}>{w.error}</p>}
        </div>
      )}
    </div>
  );
}
