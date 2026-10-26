// Contract + client tests against a running local chain (`npm run chain`). Resets the chain first.
// Focus: accountability. Every write records who/when/previous value; refused attempts are RECORDED, not lost.
import { Chain, ACCOUNT } from "../packages/server/chain";
import { publishNext, adminKeyFromSeed, canonical, sha256hex } from "../packages/core/registry";

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
let rej = await w(ACCOUNT.admin, "2026-09-02T00:00:00Z", (c) => c.publishRegistry(1, "0x" + v1.hash, "0x" + "00".repeat(32), "replay v1", "0x", "0x"));
ok("re-publishing v1 is refused AND reported (not a silent revert)", rej.rejected && /consecutive/.test(rej.reason!), JSON.stringify(rej));
rej = await w(ACCOUNT.admin, "2026-09-02T00:00:01Z", (c) => c.publishRegistry(3, "0x" + v3.hash, "0x" + v2.hash, "skip", "0x", "0x"));
ok("skipping to v3 is refused and reported", rej.rejected && /consecutive/.test(rej.reason!));
rej = await w(ACCOUNT.admin, "2026-09-02T00:00:02Z", (c) => c.publishRegistry(2, "0x" + v2.hash, "0x" + "ab".repeat(32), "bad prev", "0x", "0x"));
ok("a wrong previous hash is refused and reported", rej.rejected && /previous hash/.test(rej.reason!));
rej = await w(ACCOUNT["uni-x"], "2026-09-02T00:00:03Z", (c) => c.publishRegistry(2, "0x" + v2.hash, "0x" + v1.hash, "outsider", "0x", "0x"));
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
const L1 = canonical({ list: "v1", revoked: [] }), L2 = canonical({ list: "v2", revoked: [3] }), h1 = sha256hex(L1), h2 = sha256hex(L2);
await chain.publishStatus(KEY_A, 1, h1, "initial list", ACCOUNT["uni-x"], "2026-10-24T09:01:00Z", L1);
await chain.publishStatus(KEY_A, 2, h2, "slot #3 revoked", ACCOUNT["uni-x"], "2026-10-24T09:02:00Z", L2);
snap = await chain.snapshot();
const [s1, s2] = snap.status[KEY_A];
ok("status v2 names status v1's hash as its previous value", s2.prevHash === s1.hash && s1.hash === h1 && s2.hash === h2);
ok("status records name the publisher and time", s2.publisherLabel.includes("Northfield") && s2.time === "2026-10-24T09:02:00.000Z");
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:03:00Z", (c) => c.publishStatusList(hex32(KEY_A), 2, JUNK, "replay", "0x"));
ok("re-publishing an old version number is refused and reported (no rollback by version)", rej.rejected && /consecutive/.test(rej.reason!));
rej = await w(ACCOUNT.stranger, "2026-10-24T09:03:01Z", (c) => c.publishStatusList(hex32(KEY_A), 3, JUNK, "forged list", "0x"));
ok("an outsider cannot publish a status list: refused and reported", rej.rejected && /authorised account/.test(rej.reason!));

ok("the chain holds the EXACT previous value: stored content re-hashes to the recorded hash", sha256hex(s1.content) === s1.hash && sha256hex(s2.content) === s2.hash && JSON.parse(s1.content).revoked.length === 0 && JSON.parse(s2.content).revoked[0] === 3);
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:03:30Z", (c) => c.publishStatusList(hex32(KEY_A), 3, "0x" + "ab".repeat(32), "lying hash", Buffer.from(L2)));
ok("content that does not hash to the stated hash is refused and reported (a record cannot lie about its content)", rej.rejected && /does not hash/.test(rej.reason!), JSON.stringify(rej));

console.log("--- access-log heads: only the auditor, strictly in order");
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:04:00Z", (c) => c.anchorAuditHead(1, JUNK));
ok("before an auditor is set, nobody can anchor a head (refused and reported)", rej.rejected && /auditor/.test(rej.reason!));
rej = await w(ACCOUNT["uni-x"], "2026-10-24T09:04:01Z", async (c) => c.setAuditor(await addr(8)));
ok("only the admin can name the auditor (refused and reported)", rej.rejected && /not the registry admin/.test(rej.reason!));
await chain.setAuditor(ACCOUNT.auditor, "2026-10-24T09:05:00Z");
await chain.anchorAuditHead(1, "aa".repeat(32));
rej = await w(ACCOUNT.stranger, "2026-10-24T09:05:30Z", (c) => c.anchorAuditHead(2, JUNK));
ok("a stranger cannot anchor a head (refused and reported)", rej.rejected);
rej = await w(ACCOUNT.auditor, "2026-10-24T09:05:31Z", (c) => c.anchorAuditHead(5, JUNK));
ok("a head must carry the next sequence number (no gaps or rewrites)", rej.rejected && /consecutive/.test(rej.reason!));
rej = await w(ACCOUNT.auditor, "2026-10-24T09:05:32Z", (c) => c.anchorAuditHead(1, JUNK));
ok("an anchored sequence number can never be re-anchored with different content", rej.rejected);
await chain.anchorAuditHead(2, "bb".repeat(32));
snap = await chain.snapshot();
ok("heads are recorded in order with block, tx and time", snap.auditHeads.map((h) => h.seq).join() === "1,2" && snap.auditHeads[0].head === "aa".repeat(32) && snap.auditHeads[1].blockNumber > snap.auditHeads[0].blockNumber);

console.log("--- registry continues; the node forbids rewriting time");
await chain.publishRegistry(v2, "2026-10-25T10:05:00Z", "uni-x key declared compromised");
snap = await chain.snapshot();
ok("registry content on the chain re-hashes to its hash and v1 is recoverable", sha256hex(snap.registry[0].content) === snap.registry[0].hash && JSON.parse(snap.registry[0].content).version === 1);
ok("v2 extends v1 (prevHash = v1's hash)", snap.registry.length === 2 && snap.registry[1].prevHash === v1.hash);
const head = (await chain.provider.send("eth_getBlockByNumber", ["latest", false])).timestamp;
let refused = false; try { await chain.provider.send("evm_setNextBlockTimestamp", [parseInt(head, 16) - 86400]); } catch { refused = true; }
ok("the node refuses a block earlier than its parent (no backdating)", refused);

console.log("--- the audit feed tells the whole story");
const audit = snap.audit;
const rejected = audit.filter((e) => e.kind === "rejected");
ok("every refused attempt is in the feed (actor, time, action, reason)", rejected.length === 15 && rejected.every((e) => e.actor && e.time && e.action && e.note), `rejected=${rejected.length}`);
ok("refused attempts name the account that made them", rejected.some((e) => e.actorLabel.includes("Unknown account")) && rejected.some((e) => e.actorLabel.includes("Northfield")) && rejected.some((e) => e.actorLabel === "Registry admin"));
ok("every entry has block, transaction, time and actor", audit.every((e) => e.blockNumber >= 0 && /^0x[0-9a-f]{64}$/.test(e.txHash) && e.time && e.actor));
ok("feed is in chain order", audit.every((e, i) => i === 0 || audit[i - 1].blockNumber <= e.blockNumber));
ok("changes carry a previous value", audit.find((e) => e.action === "Registry v2 published")!.previous === v1.hash && audit.find((e) => e.action === "Status list v2 published")!.previous === h1);

console.log("--- verification receipts: any wallet, its own gas, recorded once");
const RC = "0x" + "ab".repeat(32);
let before = await chain.snapshot();
const walletBal0 = await chain.balanceOf(await addr(ACCOUNT.stranger));
let rr = await w(ACCOUNT.stranger, "2026-11-01T00:00:00Z", (c) => c.recordVerification(RC, 3, true));
ok("an account with no role CAN record a receipt (it is open by design)", !rr.rejected);
snap = await chain.snapshot();
const rcpt = snap.receipts.find((r) => "0x" + r.receipt === RC);
ok("the receipt names the wallet that sent it, the registry version and the verdict", !!rcpt && rcpt.verifier === await addr(ACCOUNT.stranger) && rcpt.registryVersion === 3 && rcpt.accepted === true, JSON.stringify(rcpt));
ok("the sender paid gas", (await chain.balanceOf(await addr(ACCOUNT.stranger))) < walletBal0);
ok("the receipt appears in the audit feed under the wallet's address", snap.audit.some((e) => e.action === "Verification receipt anchored" && e.actor === rcpt!.verifier));
rr = await w(ACCOUNT["uni-x"], "2026-11-01T00:05:00Z", (c) => c.recordVerification(RC, 3, false));
ok("the same receipt cannot be recorded twice, by anyone (the attempt is recorded)", rr.rejected && /already recorded/.test(rr.reason ?? ""), JSON.stringify(rr));
ok("the original author and verdict are unchanged", (await chain.snapshot()).receipts.find((r) => "0x" + r.receipt === RC)!.accepted === true);
rr = await w(ACCOUNT.stranger, "2026-11-01T00:10:00Z", (c) => c.recordVerification("0x" + "00".repeat(32), 1, true));
ok("an empty receipt is refused", rr.rejected);
ok("a receipt write does not grant any other authority", (await w(ACCOUNT.stranger, "2026-11-01T00:15:00Z", (c) => c.publishRegistry(9, JUNK, JUNK, "x", "0x", "0x"))).rejected);
const info = await chain.info();
ok("chain info tells a wallet how to join (id, rpc, symbol, contract, roles)", info.chainId === 31337 && info.chainIdHex === "0x7a69" && /^https?:\/\//.test(info.rpc) && info.symbol === "ETH" && info.local === true && info.contract === chain.address && info.roles.length === 6 && !info.roles.some((r) => r.role === "stranger"), JSON.stringify(Object.keys(info)));
ok("the network is named TEST in MetaMask's list", /TEST/.test(info.name), info.name);
ok("a public deployment's info carries the https gateway address", (await chain.info("https://example.test/rpc")).rpc === "https://example.test/rpc");
const f = await chain.fund("0x000000000000000000000000000000000000dEaD");
ok("the local faucet sends test ETH", Number(f.balance) >= 1);
let threw = ""; try { await chain.fund("not-an-address"); } catch (e: any) { threw = e.message; }
ok("the faucet refuses a malformed address", /valid address/.test(threw), threw);

console.log("--- the contract cannot hold or move money");
const abi = (await import("../chain/TrustAnchor.json", { with: { type: "json" } })).default.abi as any[];
ok("no payable function, no receive and no fallback in the ABI", !abi.some((x) => x.stateMutability === "payable" || x.type === "receive" || x.type === "fallback"));
const { parseEther } = await import("ethers");
const stranger = (chain as any).signers[ACCOUNT.stranger];
let sentWithCall = "", sentPlain = "";
try { await (chain.contract!.connect(stranger) as any).recordVerification("0x" + "cd".repeat(32), 1, true, { value: parseEther("1") }); } catch (e: any) { sentWithCall = String(e.shortMessage ?? e.message); }
try { await (await stranger.sendTransaction({ to: chain.address, value: parseEther("1") })).wait(); } catch (e: any) { sentPlain = String(e.shortMessage ?? e.message); }
ok("attaching ETH to a contract call is refused by the chain", sentWithCall !== "", sentWithCall);
ok("sending ETH straight to the contract is refused by the chain", sentPlain !== "", sentPlain);
ok("the contract's balance is zero", (await chain.balanceOf(chain.address)) === 0n);

console.log("--- reset");
await chain.reset();
snap = await chain.snapshot();
ok("reset returns to a clean chain with a fresh contract", snap.ok && snap.registry.length === 0 && snap.anchors.length === 0 && snap.audit.length === 0, JSON.stringify({ ok: snap.ok, err: snap.error }));
console.log(fails === 0 ? "\nALL CHAIN CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
