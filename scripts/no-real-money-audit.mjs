// Audits that no real money or real-network transaction can be involved. Part 1 reads the code in this repository. Part 2 probes a running
// copy of the app (local by default; set APP=https://... for a deployed one). Part 3 loads the pages in a browser and lists who they contact.
// Nothing here sends a transaction that changes state. Usage: node scripts/no-real-money-audit.mjs   (npm run audit:money)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { HDNodeWallet, Mnemonic, Wallet, parseEther } from "ethers";

const APP = (process.env.APP ?? "http://localhost:8787").replace(/\/$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let fails = 0;
const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "   -> " + detail)); };
const git = (...args) => { try { return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return e.status === 1 ? "" : (() => { throw e; })(); } };
const SRC = ["apps/web/src", "packages", "contracts", "chain/compile.mjs", "Dockerfile", "render.yaml", "hardhat.config.cjs"];

console.log("--- Part 1: the code");
const risky = git("grep", "-n", "-i", "-E", "infura|alchemy|etherscan|quicknode|stripe|paypal|razorpay|api[_-]?key|secret[_-]?key|mnemonic|seed phrase", "--", ...SRC).trim();
ok("no payment service, real-network RPC provider, API key or seed phrase anywhere in the source", risky === "", risky.split("\n")[0]);

const sendSites = git("grep", "-n", "eth_sendTransaction", "--", "apps/web/src").trim().split("\n").filter((l) => l && !/^\S+:\d+:\s*(\*|\/\/)/.test(l));
ok("the browser has exactly one place that can send a transaction", sendSites.length === 1, sendSites.join(" | "));
ok("and that transaction's value is hard-coded to zero", /eth_sendTransaction.*value:\s*"0x0"/.test(sendSites[0] ?? ""), sendSites[0] ?? "none");
const walletSrc = readFileSync("apps/web/src/wallet.ts", "utf8");
ok("it is refused unless both the server and the wallet are on chain 31337", /TEST_CHAIN_ID = 31337/.test(walletSrc) && /isTestChain\(info\.chainId\)/.test(walletSrc) && /isTestChain\(walletChain\)/.test(walletSrc));

const m = Mnemonic.fromPhrase("test test test test test test test test test test test junk");
const hardhat = new Set(Array.from({ length: 20 }, (_, i) => HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${i}`).privateKey.toLowerCase()));
// A key that could control value would be a 64-hex string next to the words private/priv/secret that is NOT a Hardhat default test key.
const inKeyContext = git("grep", "-n", "-i", "-E", "(private|priv|secret).{0,24}0x[0-9a-fA-F]{64}", "--", "apps", "packages", "scripts", "tests").trim().split("\n").filter(Boolean)
  .filter((l) => [...l.matchAll(/0x[0-9a-fA-F]{64}/g)].some((x) => !hardhat.has(x[0].toLowerCase())));
ok("every private key in the repository is one of Hardhat's published test accounts (public, worthless)", inKeyContext.length === 0, inKeyContext[0]);
ok("no .env, key or keystore file is tracked", git("ls-files").split("\n").filter((f) => /(^|\/)\.env|\.pem$|id_rsa|\.key$|keystore|wallet\.json/i.test(f)).length === 0);

const abi = JSON.parse(readFileSync("chain/TrustAnchor.json", "utf8")).abi;
ok("the contract's ABI has no payable function, no receive and no fallback", !abi.some((x) => x.stateMutability === "payable" || x.type === "receive" || x.type === "fallback"));
const sol = readFileSync("contracts/TrustAnchor.sol", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
ok("the contract source cannot move value (no payable, transfer, send, call, delegatecall or selfdestruct)", !/\bpayable\b|\.transfer\(|\.send\(|\.call\b|delegatecall|selfdestruct/.test(sol));

console.log(`--- Part 2: the running app at ${APP}`);
const rpc = async (method, params = []) => (await fetch(APP + "/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
let info = null;
for (let i = 0; i < 40 && !info?.contract; i++) { // a freshly started or waking app needs a moment to deploy its contract
  try { info = await (await fetch(APP + "/api/chain/info")).json(); } catch { /* retry */ }
  if (!info?.contract) await new Promise((r) => setTimeout(r, 1500));
}
if (!info?.contract) { ok("the app is reachable", false, "start it with npm run dev, or set APP"); }
else {
  ok("it runs on chain 31337, the development chain", info.chainId === 31337 && info.local === true, JSON.stringify({ chainId: info.chainId }));
  ok("the wallet network is named TEST", /TEST/.test(info.name), info.name);
  ok("the contract exists and holds exactly zero ETH", (await rpc("eth_getCode", [info.contract, "latest"])).result !== "0x" && BigInt((await rpc("eth_getBalance", [info.contract, "latest"])).result) === 0n);
  const user = Wallet.createRandom();
  const nonce = parseInt((await rpc("eth_getTransactionCount", [user.address, "latest"])).result, 16);
  const base = { chainId: 31337, nonce, gasLimit: 200000, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, type: 2 };
  const sendRaw = async (tx) => (await rpc("eth_sendRawTransaction", [await user.signTransaction(tx)]));
  ok("a plain ETH transfer through the public gateway is refused", !!(await sendRaw({ ...base, to: Wallet.createRandom().address, value: parseEther("1") })).error);
  ok("sending value to the contract is refused", !!(await sendRaw({ ...base, to: info.contract, value: 1n, data: "0x" })).error);
  ok("a transaction signed for Ethereum mainnet is refused", !!(await sendRaw({ ...base, chainId: 1, to: info.contract, data: "0x" })).error);
  ok("the node's own account and balance commands are refused", (await Promise.all(["eth_sendTransaction", "eth_accounts", "hardhat_setBalance", "personal_sign"].map((x) => rpc(x)))).every((r) => !!r.error));
}

console.log("--- Part 3: who the pages contact");
if (!existsSync(CHROME)) console.log("  skip   Chrome not found (set CHROME=...); the browser traffic check was not run");
else if (info?.contract) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    const own = new URL(APP).origin, seen = new Map();
    for (const hash of ["", "#app/verify", "#app/wallet", "#app/trust", "#app/issue", "#app/audit"]) {
      const page = await browser.newPage();
      page.on("request", (r) => { if (!/^(data|blob|about):/.test(r.url())) { const o = new URL(r.url()).origin; seen.set(o, (seen.get(o) ?? 0) + 1); } });
      await page.goto(APP + "/" + hash, { waitUntil: "networkidle0", timeout: 60000 }); await new Promise((r) => setTimeout(r, 800)); await page.close();
    }
    const others = [...seen.keys()].filter((o) => o !== own);
    ok(`all six pages talk only to their own server (${[...seen.values()].reduce((a, b) => a + b, 0)} requests)`, others.length === 0, others.join(", "));
  } finally { await browser.close(); }
}

console.log(fails ? `\n${fails} FINDING(S): see FAIL lines above` : "\nno real-money path found: all checks passed");
process.exit(fails ? 1 : 0);
