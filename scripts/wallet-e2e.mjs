// Drives the real site in headless Chrome with a stand-in for MetaMask: window.ethereum forwards each EIP-1193 request to a real
// ethers Wallet talking to the real local chain. It exercises our code paths (connect, add network, faucet, personal_sign, send tx,
// gas receipt), not MetaMask's own UI. Needs `npm run dev` (or start) running. Usage: node scripts/wallet-e2e.mjs
import puppeteer from "puppeteer-core";
import { JsonRpcProvider, Wallet, getBytes } from "ethers";

const APP = process.env.APP ?? "http://localhost:8787", RPC = "http://127.0.0.1:8545";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
let fails = 0;
const ok = (n, c, x = "") => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  " + x)); };
const api = (p, b) => fetch(APP + p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(wallet, label, fn) {
  console.log("--- " + label + "  " + wallet.address);
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const w = wallet.connect(provider);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
  let chain = "0x1", added = false, failSend = true; const log = [];
  await page.exposeFunction("__eth", async (method, params) => {
    log.push(method);
    try {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return { result: [w.address] };
        case "eth_chainId": return { result: chain };
        case "wallet_switchEthereumChain": if (!added) return { error: { code: 4902, message: "Unrecognized chain ID" } }; chain = params[0].chainId; return { result: null };
        case "wallet_addEthereumChain": if (params[0].chainId !== "0x7a69" || !params[0].rpcUrls.includes(RPC)) return { error: { code: -32602, message: "bad chain params" } }; added = true; chain = params[0].chainId; return { result: null };
        case "eth_getBalance": return { result: await provider.send("eth_getBalance", params) };
        case "personal_sign": return { result: await w.signMessage(getBytes(params[0])) };
        case "eth_sendTransaction": { if (failSend) { failSend = false; return { error: { code: -32603, message: "nonce too high" } }; } const t = await w.sendTransaction({ to: params[0].to, data: params[0].data }); return { result: t.hash }; }
        case "eth_getTransactionReceipt": return { result: await provider.send("eth_getTransactionReceipt", params) };
        default: return { error: { code: -32601, message: "unsupported in test: " + method } };
      }
    } catch (e) { return { error: { code: e.code ?? -32000, message: String(e.shortMessage ?? e.message) } }; }
  });
  await page.evaluateOnNewDocument(() => {
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) { const r = await window.__eth(method, params ?? []); if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.result; } };
  });
  const click = async (text, sel = "button") => { const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].find((b) => b.textContent.trim().startsWith(t) && !b.disabled), text, sel); const el = h.asElement(); if (!el) throw new Error("no button: " + text); await el.click(); };
  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = async (t, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await text()).includes(t)) return true; await sleep(150); } return false; };
  try { await fn({ page, click, text, waitText, w, log, provider }); } finally { await browser.close(); }
}

await api("/api/demo/reset", {});

// 1) A brand-new free wallet: no role. Connect, add the network, take free test ETH, anchor a receipt, get refused when acting as admin.
const fresh = Wallet.createRandom();
await session(fresh, "fresh wallet (no role)", async ({ page, click, text, waitText, log, provider }) => {
  await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" });
  await click("Connect");
  ok("panel offers MetaMask", await waitText("Connect MetaMask"));
  await click("Connect MetaMask");
  ok("connected: full address shown", await waitText(fresh.address));
  ok("the chain was added to the wallet (switch refused, then add)", log.includes("wallet_addEthereumChain") && log.includes("wallet_switchEthereumChain"), log.join(","));
  ok("fresh wallet has no role", await waitText("No role"));
  await click("Get free test ETH");
  ok("faucet funded the wallet", await waitText("1.0000 ETH"));
  ok("balance on the chain matches", (await provider.getBalance(fresh.address)) === 10n ** 18n);
  // a privileged button, signed by this wallet, must be refused and recorded under THIS address
  await page.keyboard.press("Escape");
  await click("Restore from the chain");
  ok("UI shows the refusal", await waitText("not authorised"));
  ok("banner says this address holds no role", await waitText("holds no role"));
  ok("checklist ticked connect, funding and the refused action from real state", await waitText("4 of 6 done"));
  { const t = (await text()).toLowerCase(); ok("checklist lists the refused attempt under this address", t.includes("what the system recorded about") && t.includes("denied")); }
  const pub = await api("/api/public");
  const e = pub.accessLog[0];
  ok("access log names the wallet's real address as actor", e.actor.toLowerCase() === fresh.address.toLowerCase() && e.outcome === "denied", JSON.stringify(e).slice(0, 200));
  // verification, then anchor the receipt from the wallet
  await page.goto(APP + "/#app/verify", { waitUntil: "networkidle0" });
  await click("Create verification request");
  await sleep(500);
  await click("Generate proof");
  ok("verification completes", await waitText("Anchor this result from your wallet", 60000));
  await click("Anchor as");
  ok("a MetaMask nonce error is explained in plain words", await waitText("Clear activity tab data"));
  await click("Anchor as");
  ok("receipt anchored (block, gas, fee shown)", await waitText("fee ", 20000) && (await text()).includes("Block"));
  const after = await api("/api/public");
  const r = after.receipts[0];
  ok("chain holds one receipt authored by the wallet", after.receipts.length === 1 && r.verifier.toLowerCase() === fresh.address.toLowerCase(), JSON.stringify(after.receipts));
  ok("the receipt matches the verifier's own audit record", r.matchesAudit === true);
  ok("wallet paid gas (balance fell)", (await provider.getBalance(fresh.address)) < 10n ** 18n);
  await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" });
  ok("checklist now shows the anchored receipt (5 of 6)", await waitText("5 of 6 done"));
  ok("the receipt is in the chain audit feed with the wallet as actor", after.chain.audit.some((a) => a.action === "Verification receipt anchored" && a.actor.toLowerCase() === fresh.address.toLowerCase()));
});

// 2) The admin test key imported into the wallet: the same button now succeeds, attributed to the admin address.
await session(new Wallet(ADMIN_KEY), "wallet holding the admin role", async ({ page, click, waitText }) => {
  await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" });
  await click("Connect"); await click("Connect MetaMask");
  ok("role recognised", await waitText("Registry admin"));
  await page.keyboard.press("Escape");
  ok("banner names the role the wallet holds", await waitText("holds the role"));
  await page.keyboard.press("Escape");
  await click("Restore from the chain");
  await sleep(1500);
  const e = (await api("/api/public")).accessLog[0];
  ok("restore accepted and attributed to the admin address", e.outcome === "ok" && e.actorLabel === "Registry admin", JSON.stringify(e).slice(0, 200));
});

// 3) No wallet installed: the page must degrade to the demo keys and say how to get one.
{
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.className.includes("walletpill")).click());
  await sleep(300);
  const t = await page.evaluate(() => document.body.innerText);
  console.log("--- no wallet installed");
  ok("explains how to install a free wallet", t.includes("Install MetaMask"));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Restore from the chain")).click());
  await sleep(1500);
  const e = (await api("/api/public")).accessLog[0];
  ok("demo-key signing still works", e.outcome === "ok", JSON.stringify(e).slice(0, 160));
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : "\nall wallet checks passed");
process.exit(fails ? 1 : 0);
