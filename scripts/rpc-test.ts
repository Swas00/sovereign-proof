// Security test for the public JSON-RPC gateway (/rpc). Needs the app running. Usage: npx tsx scripts/rpc-test.ts
// A hostile visitor can reach /rpc. It must let a wallet read the chain and record a receipt, and nothing else.
import { Interface, JsonRpcProvider, Wallet, parseEther } from "ethers";

const APP = process.env.APP ?? "http://127.0.0.1:8787";
let fails = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "   -> " + x)); };
const rpc = async (method: string, params: unknown[] = []) => (await fetch(APP + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json() as Promise<any>;
const post = (p: string, b: unknown) => fetch(APP + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await post("/api/demo/reset", {});
const info = await (await fetch(APP + "/api/chain/info")).json() as any;
const contract = info.contract as string;
const iface = new Interface(["function recordVerification(bytes32,uint32,bool) returns (bool)", "function publishRegistry(uint32,bytes32,bytes32,string,bytes,bytes) returns (bool)"]);
const ADMIN = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const user = Wallet.createRandom();

console.log("--- reads a wallet needs");
ok("eth_chainId is 31337", (await rpc("eth_chainId")).result === "0x7a69");
ok("eth_blockNumber works", /^0x/.test((await rpc("eth_blockNumber")).result ?? ""));
ok("the contract has code", ((await rpc("eth_getCode", [contract, "latest"])).result ?? "0x") !== "0x");
ok("eth_feeHistory and eth_gasPrice work (MetaMask needs them)", !!(await rpc("eth_gasPrice")).result && !!(await rpc("eth_feeHistory", ["0x1", "latest", [50]])).result);

console.log("--- everything that could change or take over the chain is refused");
for (const m of ["hardhat_setBalance", "hardhat_reset", "hardhat_impersonateAccount", "hardhat_mine", "evm_mine", "evm_setNextBlockTimestamp", "evm_increaseTime", "eth_accounts", "eth_sendTransaction", "personal_sign", "eth_sign", "debug_traceTransaction", "eth_getStorageAt", "anvil_setBalance"]) {
  const r = await rpc(m, m === "hardhat_setBalance" ? [user.address, "0xde0b6b3a7640000"] : []);
  ok(`${m} is refused`, !!r.error && r.result === undefined, JSON.stringify(r).slice(0, 120));
}
const probe = await (await fetch(APP + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [user.address, "latest"] }) })).json() as any;
ok("the refused hardhat_setBalance did not change anything", probe.result === "0x0", JSON.stringify(probe));
const batch = await (await fetch(APP + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, { jsonrpc: "2.0", id: 2, method: "hardhat_mine", params: ["0x10"] }]) })).json() as any[];
ok("a batch is checked item by item", batch[0].result === "0x7a69" && !!batch[1].error);
ok("a malformed body is rejected", (await fetch(APP + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: "123" })).status === 400);

console.log("--- signed transactions: only a zero-value recordVerification to the contract");
await post("/api/wallet/fund", { address: user.address }); await sleep(300);
const nonceOf = async (a: string) => parseInt((await rpc("eth_getTransactionCount", [a, "latest"])).result, 16);
const raw = (w: Wallet, o: any) => w.signTransaction({ chainId: 31337, nonce: 0, gasLimit: 200000, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, type: 2, ...o });
const send = async (w: Wallet, o: any) => rpc("eth_sendRawTransaction", [await raw(w, { nonce: await nonceOf(w.address), ...o })]);
const receipt = "0x" + "ab".repeat(32);
const good = iface.encodeFunctionData("recordVerification", [receipt, 1, true]);
let r = await send(user, { to: Wallet.createRandom().address, value: parseEther("0.5") });
ok("a plain ETH transfer is refused", !!r.error, JSON.stringify(r));
r = await send(user, { to: contract, data: good, value: 1n });
ok("recordVerification with any value attached is refused", !!r.error && /value/.test(r.error.message), JSON.stringify(r));
r = await send(user, { to: Wallet.createRandom().address, data: good });
ok("recordVerification to a different contract is refused", !!r.error, JSON.stringify(r));
r = await send(ADMIN, { to: contract, data: iface.encodeFunctionData("publishRegistry", [9, "0x" + "11".repeat(32), "0x" + "22".repeat(32), "x", "0x", "0x"]) });
ok("even the public admin key cannot publish a registry through the gateway", !!r.error && /recordVerification/.test(r.error.message), JSON.stringify(r));
r = await rpc("eth_sendRawTransaction", [await user.signTransaction({ chainId: 1, nonce: 0, gasLimit: 200000, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, type: 2, to: contract, data: good })]);
ok("a transaction signed for another chain (mainnet) is refused", !!r.error && /chain/.test(r.error.message), JSON.stringify(r));
r = await rpc("eth_sendRawTransaction", ["0xdeadbeef"]);
ok("garbage is refused", !!r.error);
const before = (await (await fetch(APP + "/api/public")).json() as any).receipts.length;
r = await send(user, { to: contract, data: good });
ok("a valid signed receipt is accepted", !!r.result && !r.error, JSON.stringify(r));
await sleep(500);
const pub = await (await fetch(APP + "/api/public")).json() as any;
ok("and it is recorded on the chain under the sender's address", pub.receipts.length === before + 1 && pub.receipts[pub.receipts.length - 1].verifier.toLowerCase() === user.address.toLowerCase());

await post("/api/demo/reset", {});
console.log(fails ? `\n${fails} FAILED` : "\nall gateway checks passed");
process.exit(fails ? 1 : 0);
