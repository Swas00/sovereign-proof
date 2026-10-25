import { ShieldAlert, ShieldCheck, KeyRound } from "lucide-react";
import { connect, roleOf, shortAddr, useWalletState } from "../wallet";

/** One line above the authority buttons: who will sign the next click, and whether that signer has any authority. */
export default function ActingAs() {
  const w = useWalletState();
  const using = w.signWith === "wallet" && !!w.account;
  const role = using ? roleOf(w.account, w.info) : null;
  if (!using) {
    return (
      <p className="actingas" data-state="demo"><KeyRound size={15} aria-hidden /> <span>Signing with the built-in demo role keys.{w.installed && <> <button type="button" className="linkbtn" onClick={connect}>Use my wallet instead</button></>}</span></p>
    );
  }
  return role
    ? <p className="actingas" data-state="role"><ShieldCheck size={15} aria-hidden /> <span>Signing as <strong className="mono">{shortAddr(w.account!)}</strong>, which holds the role <strong>{role.label}</strong>. Actions in that role will be accepted.</span></p>
    : <p className="actingas" data-state="norole"><ShieldAlert size={15} aria-hidden /> <span>Signing as <strong className="mono">{shortAddr(w.account!)}</strong>, which holds no role. Authority actions will be refused and recorded under this address.</span></p>;
}
