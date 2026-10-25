import { useSyncExternalStore } from "react";

/**
 * Browser-wallet (MetaMask) support. The wallet is free to create and holds the user's key; the app never sees it.
 * Two things use it: (1) signing privileged API requests (EIP-191 personal_sign, the same message the demo keys sign), so every
 * action is attributable to a real address; (2) sending a transaction that anchors a verification receipt on the chain, where the
 * wallet pays the gas. ethers is loaded lazily so the landing page and first paint do not pay for it.
 */
type Eip1193 = { request(a: { method: string; params?: unknown }): Promise<any>; on?(e: string, f: (...a: any[]) => void): void; removeListener?(e: string, f: (...a: any[]) => void): void; isMetaMask?: boolean; providers?: Eip1193[] };
declare global { interface Window { ethereum?: Eip1193 } }

export interface ChainInfo { chainId: number; chainIdHex: string; name: string; rpc: string; symbol: string; local: boolean; contract: string; faucet: boolean; roles: { role: string; address: string; label: string }[] }
export interface WalletState {
  installed: boolean; account: string | null; chainId: number | null; balance: string | null; info: ChainInfo | null;
  /** "wallet": privileged actions are signed by the connected account. "demo": by the built-in role keys (the default). */
  signWith: "wallet" | "demo"; busy: string; error: string;
  /** Every account connected in this tab (lowercase). Lets the walkthrough keep its progress when the user switches accounts. */
  seen: string[];
}

const KEY = "sp-wallet";
const SEEN_KEY = "sp-seen";
const loadSeen = (): string[] => { try { const v = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const initial: WalletState = { installed: false, account: null, chainId: null, balance: null, info: null, signWith: "demo", busy: "", error: "", seen: [] };
let state: WalletState = initial;
const listeners = new Set<() => void>();
const set = (p: Partial<WalletState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const getWallet = () => state;
export function useWalletState(): WalletState { return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getWallet, () => initial); }

/** MetaMask if several wallets are injected; otherwise whichever provider exists. */
function provider(): Eip1193 | null {
  const e = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!e) return null;
  return e.providers?.find((p) => p.isMetaMask) ?? e;
}
/** Turns wallet and node errors into something a person can act on. */
export function friendlyError(e: any): string {
  const raw = String(e?.shortMessage ?? e?.message ?? e);
  if (e?.code === 4001 || /user (rejected|denied)/i.test(raw)) return "You rejected the request in the wallet.";
  if (e?.code === -32002) return "A request is already open in MetaMask. Open the extension and finish or cancel it.";
  if (/nonce/i.test(raw)) return "MetaMask's saved transaction count no longer matches the chain. This happens after Reset demo or a node restart. In MetaMask open Settings, Advanced, then Clear activity tab data, and try again.";
  if (/insufficient funds|exceeds balance/i.test(raw)) return "Not enough test ETH for the gas fee. Use Get free test ETH in the wallet panel.";
  return raw.slice(0, 180);
}
const msg = friendlyError;
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const roleOf = (account: string | null, info: ChainInfo | null) => info?.roles.find((r) => same(r.address, account)) ?? null;
export const shortAddr = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

async function loadInfo(): Promise<ChainInfo> {
  const r = await fetch("/api/chain/info");
  if (!r.ok) throw new Error("the chain is not reachable, so there is no network to add to the wallet");
  return r.json();
}
async function refreshBalance() {
  const p = provider(); if (!p || !state.account) return;
  try {
    const hex = await p.request({ method: "eth_getBalance", params: [state.account, "latest"] });
    const { formatEther } = await import("ethers");
    set({ balance: Number(formatEther(BigInt(hex))).toFixed(4) });
  } catch { set({ balance: null }); }
}
async function syncChainId() {
  const p = provider(); if (!p) return;
  try { set({ chainId: parseInt(await p.request({ method: "eth_chainId" }), 16) }); } catch { /* wallet locked */ }
}

/** Switch the wallet to this chain, adding it first if the wallet has never seen it. */
export async function ensureNetwork(): Promise<void> {
  const p = provider(); if (!p) throw new Error("No wallet found.");
  const info = state.info ?? (await loadInfo()); set({ info });
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: info.chainIdHex }] }); }
  catch (e: any) {
    if (e?.code !== 4902 && e?.code !== -32603) throw e; // 4902: chain unknown to the wallet
    await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: info.chainIdHex, chainName: info.name, rpcUrls: [info.rpc], nativeCurrency: { name: "Ether", symbol: info.symbol, decimals: 18 } }] });
  }
  await syncChainId();
}

async function adopt(accounts: string[]) {
  if (!accounts.length) { set({ account: null, balance: null, signWith: "demo" }); try { localStorage.removeItem(KEY); } catch { /* ignore */ } return; }
  const a = accounts[0], seen = state.seen.includes(a.toLowerCase()) ? state.seen : [...state.seen, a.toLowerCase()];
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode: progress just will not survive a reload */ }
  set({ account: a, seen });
  await Promise.all([syncChainId(), refreshBalance()]);
}

export async function connect(): Promise<void> {
  const p = provider();
  if (!p) { set({ error: "No wallet found. MetaMask is a free browser extension; install it, create a wallet, then reload." }); return; }
  set({ busy: "connect", error: "" });
  try {
    const info = await loadInfo(); set({ info });
    await adopt(await p.request({ method: "eth_requestAccounts" }));
    await ensureNetwork(); await refreshBalance();
    set({ signWith: "wallet" });
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
  } catch (e) { set({ error: msg(e) }); } finally { set({ busy: "" }); }
}
/** The wallet cannot be disconnected by a page; this stops the app using it. (Revoking access is done in the wallet itself.) */
export function disconnect() { set({ account: null, balance: null, signWith: "demo", error: "" }); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
export const setSignWith = (m: "wallet" | "demo") => set({ signWith: m });

export async function getTestEth(): Promise<void> {
  if (!state.account) return;
  set({ busy: "fund", error: "" });
  try {
    const r = await fetch("/api/wallet/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: state.account }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "faucet failed");
    await refreshBalance();
  } catch (e) { set({ error: msg(e) }); } finally { set({ busy: "" }); }
}

/** EIP-191 personal_sign of a UTF-8 message by the connected account. The server recovers the address; nothing is trusted. */
export async function personalSign(message: string): Promise<{ address: string; signature: string }> {
  const p = provider(); if (!p || !state.account) throw new Error("Connect a wallet first.");
  const { hexlify, toUtf8Bytes } = await import("ethers");
  const signature = await p.request({ method: "personal_sign", params: [hexlify(toUtf8Bytes(message)), state.account] });
  return { address: state.account, signature };
}

export interface Anchored { txHash: string; block: number; gasUsed: string; costEth: string; rejected?: string }
const IFACE = ["function recordVerification(bytes32 receipt, uint32 registryVersion, bool accepted) returns (bool)", "event Rejected(address indexed actor, string action, bytes32 indexed target, string reason, uint64 time)"];

/**
 * The only chain this app will ever send a transaction on: the local development chain, whose ETH has no value.
 * A transaction is refused (before the wallet is even asked) on any other network, so a wallet left on Ethereum mainnet or
 * any other real network cannot be charged by this app.
 */
export const TEST_CHAIN_ID = 31337;
const GAS_CAP = "0x30d40"; // 200,000 gas units: a receipt needs far less, and the cap bounds the fee if anything misbehaves
export const isTestChain = (id: number | null | undefined) => id === TEST_CHAIN_ID;

/** Sends the receipt transaction from the connected wallet (the wallet shows the gas fee and asks for confirmation). */
export async function anchorReceipt(receiptHex: string, registryVersion: number, accepted: boolean): Promise<Anchored> {
  const p = provider(); if (!p || !state.account) throw new Error("Connect a wallet first.");
  const { Interface } = await import("ethers");
  const info = await loadInfo(); set({ info });
  if (!isTestChain(info.chainId)) throw new Error(`Refusing to send: this server reports chain ${info.chainId}, which is not the local test network. Nothing was sent.`);
  await ensureNetwork();
  const walletChain = parseInt(await p.request({ method: "eth_chainId" }), 16);
  if (!isTestChain(walletChain)) throw new Error(`Your wallet is on network ${walletChain}, not the local test network. Switch networks in MetaMask. Nothing was sent.`);
  const code: string = await p.request({ method: "eth_getCode", params: [info.contract, "latest"] });
  if (!code || code === "0x") throw new Error("There is no contract at that address on this chain (was the demo reset?). Nothing was sent.");
  const iface = new Interface(IFACE);
  const data = iface.encodeFunctionData("recordVerification", ["0x" + receiptHex, registryVersion, accepted]);
  // value is always zero: the contract has no payable function, so it could not accept money even if this were changed.
  const txHash: string = await p.request({ method: "eth_sendTransaction", params: [{ from: state.account, to: info.contract, data, value: "0x0", gas: GAS_CAP }] });
  let rc: any = null;
  for (let i = 0; i < 60 && !rc; i++) { rc = await p.request({ method: "eth_getTransactionReceipt", params: [txHash] }); if (!rc) await new Promise((r) => setTimeout(r, 500)); }
  if (!rc) throw new Error("The transaction was sent but is not confirmed yet. Check the wallet.");
  await refreshBalance();
  const rej = (rc.logs as any[]).map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "Rejected");
  const gasUsed = BigInt(rc.gasUsed), price = BigInt(rc.effectiveGasPrice ?? "0x0");
  const { formatEther } = await import("ethers");
  return { txHash, block: parseInt(rc.blockNumber, 16), gasUsed: gasUsed.toString(), costEth: formatEther(gasUsed * price), rejected: rej ? String(rej.args.reason) : undefined };
}

/** Wire up wallet events once, and quietly restore a previous connection (eth_accounts never opens a popup). */
if (typeof window !== "undefined") {
  const p = provider();
  set({ installed: !!p, seen: loadSeen() });
  if (p) {
    p.on?.("accountsChanged", (a: string[]) => { void adopt(a); });
    p.on?.("chainChanged", () => { void syncChainId().then(refreshBalance); });
    let was = false; try { was = localStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
    if (was) void (async () => {
      try { const a: string[] = await p.request({ method: "eth_accounts" }); if (a.length) { set({ info: await loadInfo() }); await adopt(a); set({ signWith: "wallet" }); } } catch { /* stay on demo keys */ }
    })();
  }
}
