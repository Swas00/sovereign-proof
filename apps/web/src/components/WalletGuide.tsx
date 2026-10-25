import { Check } from "lucide-react";
import { connect, getTestEth, shortAddr, useWalletState } from "../wallet";

/**
 * A checklist for trying the wallet end to end. Every tick comes from real state (the wallet, the access log, the chain's
 * receipts), not from a click counter, so it also works as proof that each step really happened on the chain.
 */
export default function WalletGuide({ pub }: { pub: any }) {
  const w = useWalletState();
  // Progress counts every account used in this tab: step 5 has the user import the admin key and SWITCH accounts, and the refusal
  // recorded under the first account must still count.
  const mine_ = new Set(w.seen);
  const mine = (pub.accessLog ?? []).filter((e: any) => mine_.has(e.actor.toLowerCase()));
  const receipts = (pub.receipts ?? []).filter((r: any) => mine_.has(r.verifier.toLowerCase()));
  const steps: { done: boolean; title: string; how: React.ReactNode }[] = [
    { done: w.installed, title: "Have a wallet", how: w.installed ? "A wallet was found in this browser." : <>Install <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> (free), create a wallet, and reload this page.</> },
    { done: !!w.account, title: "Connect it", how: <>The wallet adds this chain by itself.{" "}{w.installed && !w.account && <button type="button" className="linkbtn" onClick={connect}>Connect now</button>}</> },
    { done: !!w.account && (Number(w.balance ?? 0) > 0 || mine.length > 0), title: "Get free test ETH for gas", how: <>This chain is local, so the ETH is free and worth nothing.{" "}{w.account && w.info?.faucet && <button type="button" className="linkbtn" onClick={getTestEth}>Send me 1 ETH</button>}</> },
    { done: mine.some((e: any) => e.outcome === "denied"), title: "Try an action without authority", how: <>With "My wallet" selected, press <strong>Restore from the chain</strong> below. Your fresh wallet has no role, so it is refused and recorded under your address.</> },
    { done: mine.some((e: any) => e.outcome === "ok"), title: "Act with authority", how: <>In the wallet panel open "Act as a demo role", copy the <strong>admin</strong> key, import it in MetaMask (Account menu, Import account), switch to that account, and press Restore again. It is accepted, attributed to the admin.</> },
    { done: receipts.length > 0, title: "Pay to anchor a result", how: <>Open <a href="#app/verify">Verify</a>, run a request, then press <strong>Anchor this result from your wallet</strong>. Confirm the gas fee in MetaMask.</> },
  ];
  const next = steps.findIndex((s) => !s.done);
  const finished = steps.filter((s) => s.done).length;
  return (
    <section className="card mt wguide" aria-labelledby="wg-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="wg-h" style={{ margin: 0 }}>Try it with your own wallet</h2>
        <span className={"badge " + (finished === steps.length ? "b-ok" : "b-warn")}>{finished} of {steps.length} done</span>
      </div>
      <ol className="wsteps">
        {steps.map((s, i) => (
          <li key={s.title} data-done={s.done} data-next={i === next}>
            <span className="wnum" aria-hidden>{s.done ? <Check size={14} strokeWidth={2.4} /> : i + 1}</span>
            <div><div><strong>{s.title}</strong></div><div className="small muted">{s.how}</div></div>
          </li>
        ))}
      </ol>
      {w.error && <p className="err small" role="alert" style={{ marginBottom: 0 }}>{w.error}</p>}
      {w.account && (
        <>
          <h3 className="mt">What the system recorded about your {w.seen.length > 1 ? `${w.seen.length} accounts` : "account"}</h3>
          {mine.length === 0 && receipts.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing yet. Each step above adds a line here, read back from the access log and the chain.</p> : (
            <div className="tablewrap"><table><thead><tr><th>Time</th><th>Who</th><th>What</th><th>Outcome</th></tr></thead>
              <tbody>
                {mine.slice(0, 6).map((e: any) => (<tr key={e.seq}><td className="mono">{e.time.slice(11, 19)}</td><td className="mono small">{shortAddr(e.actor)}</td><td className="small">{e.detail}</td><td><span className={"badge " + (e.outcome === "ok" ? "b-ok" : e.outcome === "denied" ? "b-bad" : "b-warn")}>{e.outcome}</span></td></tr>))}
                {receipts.map((r: any) => (<tr key={r.receipt}><td className="mono">{r.time.slice(11, 19)}</td><td className="mono small">{shortAddr(r.verifier)}</td><td className="small">anchored a verification receipt (block #{r.blockNumber})</td><td><span className="badge b-ok">on-chain</span></td></tr>))}
              </tbody></table></div>
          )}
        </>
      )}
    </section>
  );
}
