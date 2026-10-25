// Contract + client tests against a running local chain (`npm run chain`). Resets the chain first.
import { Chain, ACCOUNT } from "../packages/server/chain";
import { publishNext, adminKeyFromSeed } from "../packages/core/registry";

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  " + extra)); };
const reverts = async (name: string, p: Promise<unknown>, expected: string) => {
  try { await p; ok(name, false, "did not revert"); }
  catch (e: any) { const n = e.revert?.name ?? e.shortMessage ?? e.message; ok(name + `  (${String(n).slice(0, 40)})`, String(n).includes(expected) || String(e.message).includes(expected), String(n)); }
};

const chain = await Chain.connect(5, 500);
if (!chain.online) { console.log("chain not reachable:", chain.error, "\nstart it with: npm run chain"); process.exit(2); }
await chain.reset();
const c = chain.contract!;
const as = (i: number) => c.connect((chain as any).signers[i]) as typeof c;
const admin = adminKeyFromSeed("t");
const v1 = publishNext(null, () => {}, admin.priv, "2026-09-01T08:00:00Z");
const v2 = publishNext(v1, () => {}, admin.priv, "2026-10-25T10:05:00Z");
const v3 = publishNext(v2, () => {}, admin.priv, "2026-10-26T10:05:00Z");
const KEY_A = "19678910000000000000000000000000000000000000000000000000000000001", KEY_B = "12345678901234567890123456789012345678901234567890123456789012345";

console.log("--- registry records");
await chain.publishRegistry(v1, "2026-09-01T08:00:00Z");
let snap = await chain.snapshot();
ok("v1 published; stored hash equals the registry hash", snap.registry.length === 1 && snap.registry[0].hash === v1.hash, JSON.stringify(snap.registry));
ok("record time is the block time we asked for", snap.registry[0].time === "2026-09-01T08:00:00.000Z", snap.registry[0].time);
await reverts("re-publishing v1 is refused (BadVersion)", as(ACCOUNT.admin).publishRegistry.staticCall(1, "0x" + v1.hash, "0x" + "00".repeat(32)), "BadVersion");
await reverts("skipping to v3 is refused (BadVersion)", as(ACCOUNT.admin).publishRegistry.staticCall(3, "0x" + v3.hash, "0x" + v2.hash), "BadVersion");
await reverts("v2 with a wrong previous hash is refused (BadPrevHash)", as(ACCOUNT.admin).publishRegistry.staticCall(2, "0x" + v2.hash, "0x" + "ab".repeat(32)), "BadPrevHash");
await reverts("a non-admin cannot publish (NotAdmin)", as(ACCOUNT["uni-x"]).publishRegistry.staticCall(2, "0x" + v2.hash, "0x" + v1.hash), "NotAdmin");

console.log("--- anchors and authorisation");
await reverts("an unauthorised account cannot anchor (NotAnchorer)", as(ACCOUNT["uni-y"]).anchorRoot.staticCall("0x" + "01".repeat(32), "0x" + "02".repeat(32), 1), "NotAnchorer");
await reverts("a non-admin cannot authorise an anchorer (NotAdmin)", as(ACCOUNT["uni-x"]).authoriseAnchorer.staticCall("0x" + "01".repeat(32), (await (chain as any).signers[3].getAddress())), "NotAdmin");
await chain.authorise(KEY_A, ACCOUNT["uni-x"], "2026-10-01T08:59:00Z");
await chain.anchor({ issuerKeyId: KEY_A, root: "111", leafCount: 1 }, ACCOUNT["uni-x"], "2026-10-01T09:00:00Z");
snap = await chain.snapshot();
const a1 = snap.anchors[0];
ok("anchor stored with the exact key id, root and size", a1 && a1.issuerKeyId === KEY_A && a1.root === "111" && a1.leafCount === 1, JSON.stringify(a1));
ok("anchor time is the BLOCK time, and it carries its block and tx", a1.anchoredAt === "2026-10-01T09:00:00.000Z" && a1.chain!.blockNumber > 0 && /^0x[0-9a-f]{64}$/.test(a1.chain!.txHash), JSON.stringify(a1));
await reverts("an anchorer for key A cannot anchor for key B (NotAnchorer)", as(ACCOUNT["uni-x"]).anchorRoot.staticCall("0x" + BigInt(KEY_B).toString(16).padStart(64, "0"), "0x" + "02".repeat(32), 1), "NotAnchorer");
await chain.anchor({ issuerKeyId: KEY_A, root: "222", leafCount: 2 }, ACCOUNT["uni-x"], "2026-10-24T09:00:00Z");
snap = await chain.snapshot();
ok("a later anchor is appended after the first (order preserved)", snap.anchors.map((a) => a.root).join() === "111,222" && snap.anchors[1].anchoredAt === "2026-10-24T09:00:00.000Z");

console.log("--- registry continues");
await chain.publishRegistry(v2, "2026-10-25T10:05:00Z");
snap = await chain.snapshot();
ok("v2 extends the chain; both versions readable in order", snap.registry.map((r) => r.version).join() === "1,2" && snap.registry[1].prevHash === v1.hash);
console.log("--- time cannot be rewritten");
const head = (await chain.provider.send("eth_getBlockByNumber", ["latest", false])).timestamp;
await reverts("the node refuses a block earlier than its parent (no backdating)", chain.provider.send("evm_setNextBlockTimestamp", [parseInt(head, 16) - 86400]), "lower than");
await chain.anchor({ issuerKeyId: KEY_A, root: "333", leafCount: 3 }, ACCOUNT["uni-x"], "2026-09-15T00:00:00Z"); // asks for the past
snap = await chain.snapshot();
const last = snap.anchors[2];
ok("asking for a past time is bumped forward, never honoured (recorded time >= previous block)", Date.parse(last.anchoredAt) >= Date.parse(snap.anchors[1].anchoredAt), last.anchoredAt);

console.log("--- reset");
await chain.reset();
snap = await chain.snapshot();
ok("reset returns to a clean chain with a fresh contract", snap.ok && snap.registry.length === 0 && snap.anchors.length === 0, JSON.stringify({ ok: snap.ok, err: snap.error, reg: snap.registry.length, anc: snap.anchors.length }));
console.log(fails === 0 ? "\nALL CHAIN CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
