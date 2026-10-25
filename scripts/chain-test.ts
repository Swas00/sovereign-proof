// Contract + client tests against a running local chain (`npm run chain`). Resets the chain first.
// Focus: accountability. Every write records who/when/previous value; refused attempts are RECORDED, not lost.
import { Chain, ACCOUNT } from "../packages/server/chain";
import { publishNext, adminKeyFromSeed } from "../packages/core/registry";

let fails = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) fails++; console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  " + extra)); };

const chain = await Chain.connect(5, 500);
if (!chain.online) { console.log("chain not reachable:", chain.error, "\nstart it with: npm run chain"); process.exit(2); }
await chain.reset();
const w = (account: number, at: string, call: (c: any) => Promise<any>) => (chain as any).write(account, at, call, false) as Promise<{ rejected: boolean; reason?: string; action?: string }>;
const addr = async (i: number) => (await (chain as any).signers[i].getAddress()) as string;
const admin = adminKeyFromSeed("t");
const v1 = publishNext(null, () => {}, admin.priv, "2026-09-01T08:00:00Z");
const v2 = publishNext(v1, () => {}, admin.priv, "2026-10-25T10:05:00Z");
const v3 = publishNext(v2, () => {}, admin.priv, "2026-10-26T10:05:00Z");
const KEY_A = "19678910000000000000000000000000000000000000000000000000000000001";
const KEY_B = "12345678901234567890123456789012345678901234567890123456789012345";
const hex32 = (d: string) => "0x" + BigInt(d).toString(16).padStart(64, "0");
const JUNK = "0x" + "de".repeat(32);
let snap = await chain.snapshot();

console.log("--- registry: who, when, previous value");
await chain.publishRegistry(v1, "2026-09-01T08:00:00Z", "initial trust registry");
snap = await chain.snapshot();
const r1 = snap.registry[0];
ok("v1 recorded with the exact hash, block time and a note", r1.hash === v1.hash && r1.time === "2026-09-01T08:00:00.000Z");
ok("the record names WHO published it (the admin account, with its role)", r1.publisher === await addr(ACCOUNT.admin) && r1.publisherLabel === "Registry admin", r1.publisherLabel);
let rej = await w(ACCOUNT.admin, "2026-09-02T00:00:00Z", (c) => c.publishRegistry(1, "0x" + v1.hash, "0x" + "00".repeat(32), "replay v1"));
ok("re-publishing v1 is refused AND reported (not a silent revert)", rej.rejected && /consecutive/.test(rej.reason!), JSON.stringify(rej));
rej = await w(ACCOUNT.admin, "2026-09-02T00:00:01Z", (c) => c.publishRegistry(3, "0x" + v3.hash, "0x" + v2.hash, "skip"));
ok("skipping to v3 is refused and reported", rej.rejected && /consecutive/.test(rej.reason!));
rej = await w(ACCOUNT.admin, "2026-09-02T00:00:02Z", (c) => c.publishRegistry(2, "0x" + v2.hash, "0x" + "ab".repeat(32), "bad prev"));
ok("a wrong previous hash is refused and reported", rej.rejected && /previous hash/.test(rej.reason!));
rej = await w(ACCOUNT["uni-x"], "2026-09-02T00:00:03Z", (c) => c.publishRegistry(2, "0x" + v2.hash, "0x" + v1.hash, "outsider"));
ok("a non-admin cannot publish: refused and reported", rej.rejected && /not the registry admin/.test(rej.reason!));
snap = await chain.snapshot();
ok("none of the refused calls changed any state", snap.registry.length === 1);

console.log("--- anchors: authorisation, actor, previous root");
rej = await w(ACCOUNT["uni-y"], "2026-09-03T00:00:00Z", (c) => c.anchorRoot(hex32(KEY_A), JUNK, 1));
ok("an unauthorised account cannot anchor: refused and reported", rej.rejected && /authorised account/.test(rej.reason!));
rej = await w(ACCOUNT["uni-x"], "2026-09-03T00:00:01Z", async (c) => c.authoriseAnchorer(hex32(KEY_A), await addr(3)));
ok("a non-admin cannot authorise anchorers: refused and reported", rej.rejected && /not the registry admin/.test(rej.reason!));
await chain.authorise(KEY_A, ACCOUNT["uni-x"], "2026-10-01T08:59:00Z");
await chain.anchor({ issuerKeyId: KEY_A, root: "111", leafCount: 1 }, ACCOUNT["uni-x"], "2026-10-01T09:00:00Z");
await chain.anchor({ issuerKeyId: KEY_A, root: "222", leafCount: 2 }, ACCOUNT["uni-x"], "2026-10-24T09:00:00Z");
snap = await chain.snapshot();
const [a1, a2] = snap.anchors;
ok("anchor time is the BLOCK time, with its block and transaction", a1.anchoredAt === "2026-10-01T09:00:00.000Z" && a1.chain!.blockNumber > 0 && /^0x[0-9a-f]{64}$/.test(a1.chain!.txHash));
ok("anchor names WHO sent it", a1.chain!.sender === await addr(ACCOUNT["uni-x"]) && /Northfield/.test(a1.chain!.senderLabel!), a1.chain!.senderLabel);
ok("second anchor records the PREVIOUS root", a1.chain!.prevRoot === undefined && a2.chain!.prevRoot === "111", String(a2.chain!.prevRoot));
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:00:05Z", (c) => c.anchorRoot(hex32(KEY_B), JUNK, 1));
ok("an anchorer for key A cannot write for key B: refused and reported", rej.rejected);

console.log("--- status lists: versioned, chained, attributable");
const h1 = "11".repeat(32), h2 = "22".repeat(32);
await chain.publishStatus(KEY_A, 1, h1, "initial list", ACCOUNT["uni-x"], "2026-10-24T09:01:00Z");
await chain.publishStatus(KEY_A, 2, h2, "slot #3 revoked", ACCOUNT["uni-x"], "2026-10-24T09:02:00Z");
snap = await chain.snapshot();
const [s1, s2] = snap.status[KEY_A];
ok("status v2 names status v1's hash as its previous value", s2.prevHash === s1.hash && s1.hash === h1 && s2.hash === h2);
ok("status records name the publisher and time", s2.publisherLabel.includes("Northfield") && s2.time === "2026-10-24T09:02:00.000Z");
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:03:00Z", (c) => c.publishStatusList(hex32(KEY_A), 2, JUNK, "replay"));
ok("re-publishing an old version number is refused and reported (no rollback by version)", rej.rejected && /consecutive/.test(rej.reason!));
rej = await w(ACCOUNT.stranger, "2026-10-24T09:03:01Z", (c) => c.publishStatusList(hex32(KEY_A), 3, JUNK, "forged list"));
ok("an outsider cannot publish a status list: refused and reported", rej.rejected && /authorised account/.test(rej.reason!));

console.log("--- registry continues; the node forbids rewriting time");
await chain.publishRegistry(v2, "2026-10-25T10:05:00Z", "uni-x key declared compromised");
snap = await chain.snapshot();
ok("v2 extends v1 (prevHash = v1's hash)", snap.registry.length === 2 && snap.registry[1].prevHash === v1.hash);
const head = (await chain.provider.send("eth_getBlockByNumber", ["latest", false])).timestamp;
let refused = false; try { await chain.provider.send("evm_setNextBlockTimestamp", [parseInt(head, 16) - 86400]); } catch { refused = true; }
ok("the node refuses a block earlier than its parent (no backdating)", refused);

console.log("--- the audit feed tells the whole story");
const audit = snap.audit;
const rejected = audit.filter((e) => e.kind === "rejected");
ok("every refused attempt is in the feed (actor, time, action, reason)", rejected.length === 9 && rejected.every((e) => e.actor && e.time && e.action && e.note), `rejected=${rejected.length}`);
ok("refused attempts name the account that made them", rejected.some((e) => e.actorLabel.includes("Unknown account")) && rejected.some((e) => e.actorLabel.includes("Northfield")) && rejected.some((e) => e.actorLabel === "Registry admin"));
ok("every entry has block, transaction, time and actor", audit.every((e) => e.blockNumber >= 0 && /^0x[0-9a-f]{64}$/.test(e.txHash) && e.time && e.actor));
ok("feed is in chain order", audit.every((e, i) => i === 0 || audit[i - 1].blockNumber <= e.blockNumber));
ok("changes carry a previous value", audit.find((e) => e.action === "Registry v2 published")!.previous === v1.hash && audit.find((e) => e.action === "Status list v2 published")!.previous === h1);

console.log("--- reset");
await chain.reset();
snap = await chain.snapshot();
ok("reset returns to a clean chain with a fresh contract", snap.ok && snap.registry.length === 0 && snap.anchors.length === 0 && snap.audit.length === 0, JSON.stringify({ ok: snap.ok, err: snap.error }));
console.log(fails === 0 ? "\nALL CHAIN CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
