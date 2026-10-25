// Walks the Audit-tab checklist the way a person would, including the step where they import the admin key into MetaMask and
// SWITCH ACCOUNTS (MetaMask fires "accountsChanged"). The stand-in wallet can hold several accounts and switch between them.
// Checks that each step ticks from real state and that progress is not lost when the address changes.
// Needs the app running. Usage: node scripts/wallet-walkthrough.mjs
import puppeteer from "puppeteer-core";
import { JsonRpcProvider, Wallet, getBytes } from "ethers";

const APP = process.env.APP ?? "http://localhost:8787", RPC = "http://127.0.0.1:8545";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS; // optional folder for screenshots of the checklist after each step
const ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) => fetch(APP + p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
let fails = 0;
const ok = (n, c, x = "") => { if (!c) fails++; console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "   -> " + x)); };
const waitFor = async (cond, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await cond()) return true; } catch { /* retry */ } await sleep(200); } return false; };

await api("/api/demo/reset", {});
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const fresh = Wallet.createRandom().connect(provider), admin = new Wallet(ADMIN_KEY, provider);
let current = fresh, chain = "0x1", added = false;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 });
  await page.exposeFunction("__eth", async (method, params) => {
    try {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return { result: [current.address.toLowerCase()] }; // MetaMask reports lowercase
        case "eth_chainId": return { result: chain };
        case "wallet_switchEthereumChain": if (!added) return { error: { code: 4902, message: "Unrecognized chain ID" } }; chain = params[0].chainId; return { result: null };
        case "wallet_addEthereumChain": added = true; chain = params[0].chainId; return { result: null };
        case "eth_getBalance": case "eth_getCode": case "eth_getTransactionReceipt": return { result: await provider.send(method, params) };
        case "personal_sign": return { result: await current.signMessage(getBytes(params[0])) };
        case "eth_sendTransaction": { const t = await current.sendTransaction({ to: params[0].to, data: params[0].data }); return { result: t.hash }; }
        default: return { error: { code: -32601, message: "unsupported: " + method } };
      }
    } catch (e) { return { error: { code: e.code ?? -32000, message: String(e.shortMessage ?? e.message) } }; }
  });
  await page.evaluateOnNewDocument(() => {
    const handlers = {};
    window.ethereum = { isMetaMask: true, on(e, f) { (handlers[e] ??= []).push(f); }, removeListener() {},
      async request({ method, params }) { const r = await window.__eth(method, params ?? []); if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.result; } };
    window.__fire = (e, ...a) => (handlers[e] ?? []).forEach((f) => f(...a));
  });
  const text = () => page.evaluate(() => document.body.innerText);
  const has = async (t) => (await text()).toLowerCase().includes(t.toLowerCase());
  const waitText = (t, ms) => waitFor(async () => has(t), ms);
  const click = async (label) => {
    await waitFor(() => page.evaluate((t) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith(t) && !b.disabled), label), 8000);
    const h = await page.evaluateHandle((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(t) && !b.disabled), label);
    const el = h.asElement(); if (!el) throw new Error(`no enabled button "${label}"`); await el.click();
  };
  const done = async () => (/(\d) of 6 done/.exec(await text()) ?? [])[1];
  const shot = async (name) => { if (SHOTS) { const el = await page.$(".wguide"); if (el) await el.screenshot({ path: `${SHOTS}/walk-${name}.png` }); } };
  const switchTo = async (w) => { current = w; await page.evaluate((a) => window.__fire("accountsChanged", [a]), w.address.toLowerCase()); await sleep(600); };

  console.log("--- checklist, step by step, with a real account switch");
  await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" }); await sleep(400);
  ok("starts with the wallet found: 1 of 6", (await done()) === "1", await done());
  await page.click(".walletpill"); await click("Connect MetaMask"); await waitText("Wallet connected"); await page.keyboard.press("Escape");
  ok("after connecting: 2 of 6", await waitFor(async () => (await done()) === "2", 5000), await done());
  await click("Send me 1 ETH");
  ok("after the faucet: 3 of 6", await waitFor(async () => (await done()) === "3", 8000), await done()); await shot("3-funded");
  await click("Restore from the chain");
  ok("step 4: refused, ticks to 4 of 6", await waitFor(async () => (await done()) === "4", 8000), await done()); await shot("4-refused");

  await switchTo(admin); // the user imported the admin key into MetaMask and switched to it
  ok("banner follows the switch to the admin account", await waitText("holds the role"));
  await shot("5a-switched");
  await click("Restore from the chain");
  ok("step 5: accepted as admin (access log)", await waitFor(async () => { const e = (await api("/api/public")).accessLog[0]; return e.outcome === "ok" && e.actorLabel === "Registry admin"; }));
  ok("progress is NOT lost by switching accounts: 5 of 6", await waitFor(async () => (await done()) === "5", 8000), "shows " + (await done()) + " of 6"); await shot("5b-authority");

  await page.goto(APP + "/#app/verify", { waitUntil: "networkidle0" });
  await click("Create verification request"); await sleep(500); await click("Generate proof");
  await waitText("Anchor this result from your wallet", 60000);
  await click("Anchor as"); ok("step 6: receipt anchored from the wallet", await waitText("fee ", 20000));
  await page.goto(APP + "/#app/audit", { waitUntil: "networkidle0" }); await sleep(500);
  ok("all six steps done: 6 of 6", await waitFor(async () => (await done()) === "6", 8000), "shows " + (await done()) + " of 6"); await shot("6-complete");
  const t = (await text()).toLowerCase();
  ok("the history lists the refusal, the accepted action and the receipt, with who did each", t.includes("denied") && t.includes("on-chain") && (t.match(/registry admin|0x[0-9a-f]{4}…[0-9a-f]{4}/g) ?? []).length >= 2);
} finally { await browser.close(); }
await api("/api/demo/reset", {});
console.log(fails ? `\n${fails} FAILED` : "\nwalkthrough passed");
process.exit(fails ? 1 : 0);
