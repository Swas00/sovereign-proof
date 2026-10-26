import type { Request, Response } from "express";
import { Interface, Transaction } from "ethers";

/**
 * A public, locked-down JSON-RPC gateway for browser wallets.
 *
 * The chain behind it is a development node: its test accounts are unlocked and it accepts commands that rewrite state
 * (hardhat_*, evm_*) and sign on anyone's behalf (eth_sendTransaction). None of that may be reachable from the internet. This
 * gateway forwards only what a wallet needs to read the chain and send one kind of transaction: a signed
 * recordVerification(receipt, version, accepted) call to the TrustAnchor contract, with no value. Everything else is refused.
 * Authority actions (declare, issue, revoke, restore) never go through here: they go through the API, which checks a signature.
 */
const READ = new Set([
  "eth_chainId", "net_version", "web3_clientVersion", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getBalance", "eth_getCode",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_estimateGas", "eth_call", "eth_getLogs",
]);
const RECORD_SELECTOR = new Interface(["function recordVerification(bytes32,uint32,bool)"]).getFunction("recordVerification")!.selector;
const err = (id: unknown, message: string, code = -32601) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Returns null if the request may be forwarded, otherwise the reason it was refused. */
export function refusal(method: unknown, params: unknown, contract: string, chainId: number): string | null {
  if (typeof method !== "string") return "malformed request";
  if (READ.has(method)) return null;
  if (method === "eth_sendRawTransaction") {
    try {
      const raw = Array.isArray(params) ? String(params[0]) : "";
      const tx = Transaction.from(raw);
      if (tx.chainId !== BigInt(chainId)) return "wrong chain id";
      if (!contract || tx.to?.toLowerCase() !== contract.toLowerCase()) return "this gateway only relays calls to the TrustAnchor contract";
      if (tx.value !== 0n) return "no value may be sent";
      if (!tx.data.startsWith(RECORD_SELECTOR)) return "this gateway only relays recordVerification receipts";
      return null;
    } catch { return "unreadable transaction"; }
  }
  return `method ${method} is not available on the public gateway`;
}

export function rpcGateway(nodeUrl: string, getContract: () => string, getChainId: () => number) {
  const forward = async (body: unknown) => (await fetch(nodeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const one = async (req: any) => {
    const why = refusal(req?.method, req?.params, getContract(), getChainId());
    return why ? err(req?.id, why) : forward(req);
  };
  return async (req: Request, res: Response) => {
    try {
      const b = req.body;
      if (Array.isArray(b)) { if (b.length > 20) return res.status(400).json(err(null, "batch too large", -32600)); return res.json(await Promise.all(b.map(one))); }
      if (!b || typeof b !== "object") return res.status(400).json(err(null, "invalid request", -32600));
      res.json(await one(b));
    } catch { res.status(502).json(err(null, "chain unreachable", -32000)); }
  };
}
