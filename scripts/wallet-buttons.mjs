// Clicks every button in the demo, in a real browser, and checks each one did something observable (state on the server or
// chain, or text on the page). Part 1 runs with no wallet installed (demo keys). Part 2 covers the wallet panel. Part 3 uses
// wallets that hold each role, with a stand-in EIP-1193 provider backed by a real key on the real chain.
// Needs the app running. Usage: node scripts/wallet-buttons.mjs
import puppeteer from "puppeteer-core";
import { JsonRpcProvider, Wallet, getBytes } from "ethers";

const APP = process.env.APP ?? "http://localhost:8787", RPC = "http://127.0.0.1:8545";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const KEYS = { // the local node's public test accounts, same as packages/core/signing.ts
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "uni-x": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "med-board": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
};
const rows = []; let fails = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, b) => fetch(APP + p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
const lastLog = async () => (await api("/api/public")).accessLog[0];
const waitFor = async (cond, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await cond()) return true; } catch { /* retry */ } await sleep(200); } return false; };

async function open(wallet, fn, opts = {}) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    await browser.defaultBrowserContext().overridePermissions(APP, ["clipboard-read", "clipboard-write"]);
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
    const log = [];
    if (wallet) {
      const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
      let net = provider, w = wallet.connect(provider); // after the app adds the chain, use the RPC address it supplied (local node, or a deployed site's /rpc gateway)
      let chain = "0x1", added = false;
      await page.exposeFunction("__eth", async (method, params) => {
        log.push(method);
        try {
          switch (method) {
            case "eth_requestAccounts": case "eth_accounts": return { result: [w.address] };
            case "eth_chainId": return { result: chain };
            case "wallet_switchEthereumChain": if (opts.stuck) return { result: null }; if (!added) return { error: { code: 4902, message: "Unrecognized chain ID" } }; chain = params[0].chainId; return { result: null };
            case "wallet_addEthereumChain": if (opts.stuck) return { result: null }; net = new JsonRpcProvider(params[0].rpcUrls[0], undefined, { staticNetwork: true }); w = wallet.connect(net); added = true; chain = params[0].chainId; return { result: null };
            case "eth_getBalance": case "eth_getCode": case "eth_getTransactionReceipt": return { result: await net.send(method, params) };
            case "personal_sign": return { result: await w.signMessage(getBytes(params[0])) };
            case "eth_sendTransaction": { const t = await w.sendTransaction({ to: params[0].to, data: params[0].data }); return { result: t.hash }; }
            default: return { error: { code: -32601, message: "unsupported: " + method } };
          }
        } catch (e) { return { error: { code: e.code ?? -32000, message: String(e.shortMessage ?? e.message) } }; }
      });
      await page.evaluateOnNewDocument(() => { window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, async request({ method, params }) { const r = await window.__eth(method, params ?? []); if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.result; } }; });
    }
    const T = {
      page, log,
      text: () => page.evaluate(() => document.body.innerText),
      has: async (t) => (await T.text()).toLowerCase().includes(t.toLowerCase()),
      waitText: (t, ms = 15000) => waitFor(async () => (await T.text()).toLowerCase().includes(t.toLowerCase()), ms),
      go: async (hash) => { await page.goto(APP + "/#" + hash, { waitUntil: "networkidle0" }); await sleep(300); },
      click: async (label, sel = "button") => {
        if (sel === "button") await waitFor(() => page.evaluate((t) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith(t) && !b.disabled), label), 6000);
        const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].find((b) => b.textContent.trim().startsWith(t) && !b.disabled), label, sel);
        const el = h.asElement(); if (!el) throw new Error(`no enabled button "${label}"`); await el.click();
      },
      waitButton: (label, ms = 12000) => waitFor(() => page.evaluate((t) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith(t) && !b.disabled), label), ms),
      pill: () => page.click(".walletpill"),
      openPanel: async () => { if (!(await T.panelOpen())) { await page.click(".walletpill"); await sleep(250); } },
      closePanel: async () => { if (await T.panelOpen()) { await page.keyboard.press("Escape"); await sleep(250); } },
      panelOpen: () => page.evaluate(() => !!document.querySelector(".walletpanel")),
    };
    await fn(T);
  } finally { await browser.close(); }
}
async function step(name, fn) {
  let pass = false, detail = "";
  try { const r = await fn(); pass = r === true || (Array.isArray(r) && r[0]); detail = Array.isArray(r) ? r[1] ?? "" : ""; } catch (e) { detail = e.message.slice(0, 140); }
  if (!pass) { fails++; try { const p = await api("/api/public"), e = p.accessLog[0]; detail += `  [phase=${p.phase} outage=${p.outage} last=${e?.path} ${e?.outcome} ${e?.actorLabel}]`; } catch { /* ignore */ } }
  rows.push([pass, name, detail]); console.log((pass ? "  ok   " : "  FAIL ") + name + (pass ? "" : "   -> " + detail));
}

// ---------------------------------------------------------------- Part 1: the whole demo on the built-in demo keys (no wallet)
console.log("--- Part 1: every demo button, demo keys, no wallet installed");
await api("/api/demo/reset", {});
await open(null, async (T) => {
  await T.go("app/trust");
  await step("Trust: Reset demo", async () => { const t0 = Date.now(); await T.click("Reset demo"); return waitFor(async () => { const e = await lastLog(); return e?.path === "/api/demo/reset" && Date.parse(e.time) >= t0 - 1000; }, 30000); });
  await step("Trust: 1 · Thief issues a fake degree", async () => { await T.click("1 ·"); return waitFor(async () => (await api("/api/public")).phase === "stolen"); });
  await step("Trust: 2 · Declare key compromise (signed as the admin)", async () => { await T.click("2 ·"); return waitFor(async () => { const e = await lastLog(); return (await api("/api/public")).phase === "declared" && e.outcome === "ok" && e.actorLabel === "Registry admin"; }); });
  await step("Trust: 3 · University re-issues Alice's degree (signed as the university)", async () => { await T.click("3 ·"); return waitFor(async () => { const e = await lastLog(); return e.path === "/api/demo/reissue" && e.outcome === "ok" && /Northfield/.test(e.actorLabel); }); });
  await step("Trust: Revoke Alice's license (signed as the medical board)", async () => { await T.click("Revoke Alice's license"); return waitFor(async () => { const e = await lastLog(); return e.path === "/api/demo/revoke-license" && e.outcome === "ok" && /Medical/.test(e.actorLabel); }); });
  await step("Trust: Take down status service, then Restore", async () => {
    await T.click("Take down status service"); if (!(await waitFor(async () => (await api("/api/public")).outage === true))) return [false, "did not go offline"];
    await T.click("Restore status service"); return waitFor(async () => (await api("/api/public")).outage === false);
  });
  await step("Trust: Take down chain, then Restore", async () => {
    await T.click("Take down chain"); if (!(await waitFor(async () => (await api("/api/public")).chain.simulatedOutage === true))) return [false, "did not go offline"];
    await T.click("Restore chain"); return waitFor(async () => (await api("/api/public")).chain.simulatedOutage === false);
  });

  await T.go("app/audit");
  await step("Audit: Outsider tries to change data (all attempts refused and recorded)", async () => {
    const before = (await api("/api/public")).chain.audit.filter((e) => e.kind === "rejected").length;
    await T.click("Outsider tries to change data");
    return waitFor(async () => { const p = await api("/api/public"); return p.chain.audit.filter((e) => e.kind === "rejected").length >= before + 3 && p.accessLog.filter((e) => e.outcome === "denied").length >= 3; });
  });
  await step("Audit: Edit the stored registry (detected)", async () => { await T.click("Edit the stored registry"); return waitFor(async () => (await api("/api/integrity")).clean === false); });
  await step("Audit: Restore from the chain (repairs it)", async () => { await T.click("Restore from the chain"); return waitFor(async () => (await api("/api/integrity")).clean === true); });
  await step("Audit: Replay an old revocation list (detected)", async () => { await T.click("Replay an old revocation list"); return waitFor(async () => (await api("/api/integrity")).clean === false); });
  await step("Audit: Restore from the chain again", async () => { await T.click("Restore from the chain"); return waitFor(async () => (await api("/api/integrity")).clean === true); });
  await step("Audit: Compare served data with the chain (shows a report)", async () => { await T.click("Compare served data with the chain"); return T.waitText("clean"); });
  await step("Audit: Rewrite an access-log entry (detected)", async () => { await T.click("Rewrite an access-log entry"); return waitFor(async () => (await api("/api/access-log/verify")).ok === false); });
  await step("Audit: Verify the log against the chain (reports tampering)", async () => { await T.click("Verify the log against the chain"); return T.waitText("tampering detected"); });
});
await api("/api/demo/reset", {});
await open(null, async (T) => {
  await T.go("app/verify");
  await step("Verify: Create verification request", async () => { await T.click("Create verification request"); return T.waitText("issued. Single-use challenge"); });
  await step("Verify: Generate proof & send (real zero-knowledge proof, verdict shown)", async () => { await T.click("Generate proof"); return T.waitText("Verified", 60000); });
  await T.go("app/issue");
  await step("Issue: Sign & issue (credential appears)", async () => { await T.click("Sign & issue"); const done = await waitFor(async () => { const e = await lastLog(); return e.path === "/api/issue" && e.outcome === "ok"; }); return done && (await waitFor(async () => !(await T.has("Nothing issued yet.")), 5000)); });
});

// ---------------------------------------------------------------- Part 2: every control in the wallet panel
console.log("--- Part 2: every wallet panel control");
await api("/api/demo/reset", {});
await open(Wallet.createRandom(), async (T) => {
  await T.go("app/audit");
  await step("Pill opens the panel", async () => { await T.pill(); return T.waitText("Use your own wallet"); });
  await step("Escape closes the panel", async () => { await T.page.keyboard.press("Escape"); await sleep(200); return !(await T.panelOpen()); });
  await step("Clicking outside closes the panel", async () => { await T.pill(); await sleep(200); await T.page.click("h1"); await sleep(200); return !(await T.panelOpen()); });
  await step("Connect MetaMask (adds the network, shows the address)", async () => { await T.openPanel(); await T.click("Connect MetaMask"); return waitFor(async () => (await T.has("Wallet connected")) && (await T.has("Test network. No real money."))); });
  await step("Get free test ETH (balance rises to 1)", async () => { await T.click("Get free test ETH"); return T.waitText("1.0000 test ETH"); });
  await step("Toggle Demo keys (banner changes)", async () => { await T.openPanel(); await T.click("Demo keys"); await T.closePanel(); return T.waitText("Signing with the built-in demo role keys"); });
  await step("Toggle My wallet (banner changes back)", async () => { await T.openPanel(); await T.click("My wallet"); await T.closePanel(); return T.waitText("holds no role"); });
  await step("Checklist: Send me 1 ETH (balance rises again)", async () => {
    await sleep(5500); // the faucet allows one request per address every 5 seconds
    await T.click("Send me 1 ETH");
    return waitFor(async () => { await T.openPanel(); const ok = await T.has("2.0000 test ETH"); await T.closePanel(); return ok; }, 10000);
  });
  await step("Copy key (clipboard holds the admin demo key)", async () => {
    await T.openPanel(); await T.page.evaluate(() => document.querySelector(".walletpanel summary").click()); await sleep(200);
    await T.click("Copy key"); await sleep(400);
    const clip = await T.page.evaluate(() => navigator.clipboard.readText()); return [clip === KEYS.admin && (await T.has("Copied")), `clipboard=${clip.slice(0, 12)}…`];
  });
  await step("The audit-log service account offers no Copy key button", async () => T.page.evaluate(() => { const li = [...document.querySelectorAll(".wp-role")].find((x) => x.textContent.includes("auditor")); return !!li && !li.textContent.includes("Copy key") && li.textContent.includes("server only"); }));
  await step("Stop using wallet (pill returns to Connect)", async () => { await T.openPanel(); await T.click("Stop using wallet"); await sleep(300); return (await T.page.evaluate(() => document.querySelector(".walletpill").textContent)).includes("Connect"); });
  await step("Banner: 'Use my wallet instead' reconnects", async () => { await T.click("Use my wallet instead"); return waitFor(async () => (await T.page.evaluate(() => document.querySelector(".walletpill").textContent)).includes("0x")); });
  await T.go("app/trust");
  await step("With a roleless wallet, an authority button is refused and says what role it needs", async () => {
    await T.click("1 ·"); await waitFor(async () => (await api("/api/public")).phase === "stolen");
    await T.click("2 ·"); return T.waitText('needs the "admin" role');
  });
});
await api("/api/demo/reset", {});
await open(Wallet.createRandom(), async (T) => {
  await T.go("app/verify");
  await step("Wrong network: panel shows red warning and a working Switch button", async () => {
    await T.pill(); await T.click("Connect MetaMask"); if (!(await T.waitText("Not the test network"))) return [false, "no warning"];
    const before = T.log.filter((m) => m === "wallet_switchEthereumChain").length; await T.click("Switch"); await sleep(400);
    return [T.log.filter((m) => m === "wallet_switchEthereumChain").length > before, "Switch did not call the wallet"];
  });
}, { stuck: true });

// ---------------------------------------------------------------- Part 3: wallets that hold each role
console.log("--- Part 3: wallets holding each role (the key imported into MetaMask)");
await api("/api/demo/reset", {}); await api("/api/demo/steal", {});
await open(new Wallet(KEYS.admin), async (T) => {
  await T.go("app/trust"); await T.pill(); await T.click("Connect MetaMask"); await T.waitText("Registry admin"); await T.page.keyboard.press("Escape");
  await step("Admin wallet: Declare key compromise is accepted and attributed to the admin", async () => { await T.click("2 ·"); return waitFor(async () => { const e = await lastLog(); return (await api("/api/public")).phase === "declared" && e.outcome === "ok" && e.actorLabel === "Registry admin"; }); });
  await step("Admin wallet: the university's button is refused (wrong role)", async () => { await T.click("3 ·"); return T.waitText('needs the "uni-x" role'); });
});
await open(new Wallet(KEYS["uni-x"]), async (T) => {
  await T.go("app/trust"); await T.pill(); await T.click("Connect MetaMask"); await T.waitText("Northfield"); await T.page.keyboard.press("Escape");
  await step("University wallet: re-issue is accepted and attributed to the university", async () => { await T.click("3 ·"); return waitFor(async () => { const e = await lastLog(); return e.path === "/api/demo/reissue" && e.outcome === "ok" && /Northfield/.test(e.actorLabel); }); });
  await T.go("app/issue");
  await step("University wallet: Sign & issue is accepted", async () => { await T.click("Sign & issue"); return waitFor(async () => { const e = await lastLog(); return e.path === "/api/issue" && e.outcome === "ok" && /Northfield/.test(e.actorLabel); }); });
});
await open(new Wallet(KEYS["med-board"]), async (T) => {
  await T.go("app/trust"); await T.pill(); await T.click("Connect MetaMask"); await T.waitText("Medical Board"); await T.page.keyboard.press("Escape");
  await step("Medical board wallet: Revoke Alice's license is accepted", async () => { await T.click("Revoke Alice's license"); return waitFor(async () => { const e = await lastLog(); return e.path === "/api/demo/revoke-license" && e.outcome === "ok" && /Medical/.test(e.actorLabel); }); });
});
await api("/api/demo/reset", {});

console.log(`\n${rows.length - fails} of ${rows.length} button checks passed` + (fails ? `, ${fails} FAILED` : ""));
process.exit(fails ? 1 : 0);
