import puppeteer from "puppeteer-core";
// Responsive audit: loads every page at ~20 device profiles in its busiest state and checks for sideways scrolling, clipped or overlapping
// content, touch targets under 44px, inputs under 16px (iOS zoom), tiny text, squashed hero art and tables that scroll inside their box.
// Usage: npm run dev (or npm start), then `npm run audit:responsive [deviceNameRegex]`.  SELFTEST=1 proves the probe can fail.
// Env: BASE (default http://localhost:5173), API (default http://localhost:8787), CHROME (path to Chrome/Chromium).
const BASE = process.env.BASE ?? "http://localhost:5173", API = process.env.API ?? "http://localhost:8787";
const CHROME = process.env.CHROME ?? process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const DEVICES = [
  ["Galaxy Fold (folded)", 280, 653, true, 3], ["iPhone SE (1st gen)", 320, 568, true, 2], ["iPhone SE", 375, 667, true, 2], ["iPhone 14", 390, 844, true, 3],
  ["Pixel 7", 412, 915, true, 2.6], ["iPhone Pro Max", 430, 932, true, 3], ["Phone landscape (667x375)", 667, 375, true, 2], ["Phone landscape (844x390)", 844, 390, true, 3],
  ["Phone landscape (915x412)", 915, 412, true, 2.6], ["iPad mini", 744, 1133, true, 2], ["iPad Air", 820, 1180, true, 2], ["iPad landscape", 1180, 820, true, 2],
  ["iPad Pro 11", 834, 1194, true, 2], ["iPad Pro 12.9", 1024, 1366, true, 2], ["Narrow desktop window", 500, 800, false, 1], ["Small laptop", 1280, 720, false, 1],
  ["Laptop", 1440, 900, false, 2], ["Desktop FHD", 1920, 1080, false, 1], ["QHD", 2560, 1440, false, 1], ["Ultrawide", 3440, 1440, false, 1],
].filter(([n]) => !only || only.test(n));
const PAGES = [["landing", BASE + "/"], ["verify", BASE + "/#app/verify"], ["wallet", BASE + "/#app/wallet"], ["trust", BASE + "/#app/trust"], ["issue", BASE + "/#app/issue"], ["audit", BASE + "/#app/audit"]];

// busiest state first: incident declared, a revocation, attacks and log entries, so tables are full
await fetch(`${API}/api/demo/reset`, { method: "POST" });
{
  const b0 = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const p = await b0.newPage(); await p.setViewport({ width: 1366, height: 900 });
  await p.goto(BASE + "/#app/trust", { waitUntil: "networkidle0" });
  const btn = async (t) => { const [h] = await p.$$(`xpath/.//button[contains(., "${t}")]`); await h.click(); await sleep(1100); };
  for (const t of ["Thief issues a fake degree", "Declare key compromise", "Revoke Alice's license", "University re-issues"]) await btn(t);
  await btn("Audit"); await btn("Outsider tries to change data"); await btn("Compare served data with the chain"); await btn("Verify the log against the chain");
  await b0.close();
}

// `deviceW` is the real device width from the harness. On a mobile page innerWidth can GROW to fit wide content, which would hide the very bug we look for.
const probe = (deviceW) => {
  const vw = deviceW, vh = innerHeight, touch = matchMedia("(pointer: coarse)").matches, issues = [];
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += "#" + el.id; const c = [...el.classList].filter((x) => !x.startsWith("fx-")).slice(0, 2); if (c.length) s += "." + c.join("."); return s; };
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clippedByAncestor = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const ar = a.getBoundingClientRect(); if (ar.right <= vw + 1 && ar.left >= -1) return true; } } return false; };
  const root = document.documentElement;
  if (Math.max(root.scrollWidth, innerWidth) > vw + 1) issues.push(["page scrolls sideways", `document is ${root.scrollWidth}px wide in a ${vw}px viewport`]);
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg") && el.tagName !== "svg") continue;
    if (!visible(el) || el.id === "fx-ring" || el.id === "fx-dot") continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el)) issues.push(["element sticks out of the viewport", `${name(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`]);
  }
  // tap targets and iOS input zoom
  const need = touch ? 44 : 24;
  for (const el of document.querySelectorAll("a[href], button, select, input, [role=button]")) {
    if (!visible(el) || el.closest("svg") || el.closest(".sh-links") && getComputedStyle(el.closest(".sh-links")).display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.height < need - 0.5 || r.width < need - 0.5) { if (!(el.tagName === "A" && r.width >= need && r.height >= 20 && !touch)) issues.push([touch ? "touch target under 44px" : "click target under 24px", `${name(el)} is ${Math.round(r.width)}x${Math.round(r.height)} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`]); }
    if (touch && /^(INPUT|SELECT)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16) issues.push(["input under 16px (iOS zooms the page on focus)", `${name(el)} is ${getComputedStyle(el).fontSize}`]);
  }
  // text too small / clipped
  const seenSmall = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg") || !visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11 && !seenSmall.has(name(el))) { seenSmall.add(name(el)); issues.push(["text under 11px", `${name(el)} is ${fs}px`]); }
    const cs = getComputedStyle(el);
    if (/(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && !el.closest(".sh-root")) issues.push(["text is cut off", `${name(el)} content ${el.scrollWidth}px in ${el.clientWidth}px`]);
  }
  // siblings overlapping in key rows
  for (const c of document.querySelectorAll("header, header nav, .row, .sh-nav, .sh-links, .sh-ctas")) {
    const kids = [...c.children].filter(visible).map((k) => ({ k, r: k.getBoundingClientRect() }));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].r, b = kids[j].r, ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 3 && oy > 3) issues.push(["siblings overlap", `${name(kids[i].k)} and ${name(kids[j].k)} inside ${name(c)}`]);
    }
  }
  for (const tw of document.querySelectorAll(".tablewrap")) if (visible(tw) && tw.scrollWidth > tw.clientWidth + 2) issues.push(["table scrolls sideways inside its box", `${tw.querySelector("th")?.textContent ?? "table"}... ${tw.scrollWidth}px in ${tw.clientWidth}px`]);
  // hero: copy must stay inside the hero, below the nav
  const hero = document.querySelector(".sh-root");
  if (hero) {
    const hr = hero.getBoundingClientRect(), content = hero.querySelector(".sh-content"), nav = hero.querySelector(".sh-nav");
    if (content) { const cr = content.getBoundingClientRect(); if (cr.bottom > hr.bottom + 1 || cr.top < (nav ? nav.getBoundingClientRect().bottom : 0) - 1) issues.push(["hero copy clipped or under the nav", `content ${Math.round(cr.top)}..${Math.round(cr.bottom)} hero ${Math.round(hr.top)}..${Math.round(hr.bottom)} nav bottom ${nav ? Math.round(nav.getBoundingClientRect().bottom) : "-"}`]); }
    const art = hero.querySelector(".sh-fallback"); if (art) { const ar = art.getBoundingClientRect(); if (ar.height < 150) issues.push(["hero sculpture squashed", `the artwork is only ${Math.round(ar.height)}px tall`]); }
    const nav2 = hero.querySelector(".sh-nav"), hint = hero.querySelector(".sh-hint");
    if (art && nav2) { const ar = art.getBoundingClientRect(), nr = nav2.getBoundingClientRect(); if (ar.top < nr.bottom - 60 && ar.bottom > nr.top) issues.push(["hero sculpture runs under the nav", `art ${Math.round(ar.top)}..${Math.round(ar.bottom)} nav ${Math.round(nr.top)}..${Math.round(nr.bottom)}`]); }
    const h1 = hero.querySelector(".sh-h1"); if (h1 && h1.scrollWidth > h1.clientWidth + 2) issues.push(["hero headline wider than its box", `${h1.scrollWidth} in ${h1.clientWidth}`]);
  }
  return issues;
};

if (process.env.SELFTEST) {
  const bt = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const pt = await bt.newPage(); await pt.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await pt.goto(BASE + "/#app/verify", { waitUntil: "networkidle0" }); await sleep(500);
  await pt.evaluate(() => { const d = document.createElement("div"); d.style.cssText = "width:900px;height:20px;background:red"; document.body.appendChild(d);
    const b2 = document.createElement("button"); b2.textContent = "tiny"; b2.style.cssText = "width:20px;height:20px;font-size:8px"; document.body.appendChild(b2);
    const i2 = document.createElement("input"); i2.style.fontSize = "12px"; document.body.appendChild(i2); });
  const found = (await pt.evaluate(probe, 375)).map((x) => x[0]);
  const want = ["page scrolls sideways", "element sticks out of the viewport", "touch target under 44px", "input under 16px (iOS zooms the page on focus)"];
  console.log("probe self-test:", want.map((w) => (found.includes(w) ? "caught" : "MISSED") + " '" + w + "'").join(" | "));
  await bt.close(); process.exit(want.every((w) => found.includes(w)) ? 0 : 1);
}
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const agg = new Map(); let loads = 0;
for (const [dev, w, h, touch, dpr] of DEVICES) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h, isMobile: touch, hasTouch: touch, deviceScaleFactor: dpr });
  await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  for (const [page, url] of PAGES) {
    await p.goto(url, { waitUntil: "networkidle0" }); await sleep(page === "landing" ? 2200 : 700); loads++;
    for (const [kind, detail] of await p.evaluate(probe, w)) { const key = `${kind} | ${page} | ${detail.replace(/\d+/g, "N")}`; const e = agg.get(key) ?? { kind, page, detail, devices: new Set() }; e.devices.add(dev); agg.set(key, e); }
  }
  if (errs.length) console.log(dev, "PAGE ERRORS", errs);
  await ctx.close();
}
const rows = [...agg.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.page.localeCompare(b.page));
console.log(`\n${loads} page loads across ${DEVICES.length} device profiles -> ${rows.length} distinct problems`);
const byKind = {}; for (const r of rows) (byKind[r.kind] ??= []).push(r);
for (const [k, rs] of Object.entries(byKind)) { console.log(`\n## ${k}  (${rs.length})`); for (const r of rs.slice(0, 14)) console.log(`  [${r.page}] ${r.detail}\n        on: ${[...r.devices].slice(0, 6).join(", ")}${r.devices.size > 6 ? ` +${r.devices.size - 6} more` : ""}`); if (rs.length > 14) console.log(`  … ${rs.length - 14} more of this kind`); }
await b.close();
