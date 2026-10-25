import { describe, it, expect } from "vitest";
import { AccessLog, hashEntry, type LogEntry } from "../packages/server/accesslog";
import { requestMessage } from "../packages/core/signing";
import { canonical } from "../packages/core/canonical";

const entry = (actor: string, label: string, detail: string, outcome: LogEntry["outcome"] = "ok") =>
  ({ time: "2026-10-25T12:00:00Z", actor, actorLabel: label, method: "POST", path: "/api/demo/declare", bodySha256: "0".repeat(64), outcome, detail });
const anchorsOf = (log: AccessLog) => log.entries.map((e) => ({ seq: e.seq, head: e.hash, time: "2026-10-25T12:00:0" + e.seq + ".000Z", blockNumber: 10 + e.seq, txHash: "0x" + String(e.seq).repeat(64).slice(0, 64) }));
const build = () => { const l = new AccessLog(); l.append(entry("-", "(system)", "init")); l.append(entry("0xAdmin", "Registry admin", "declared compromise")); l.append(entry("0xBad", "Unknown account", "refused", "denied")); l.append(entry("0xMed", "State Medical Board", "revoked a slot")); return l; };

describe("hash-chained access log anchored on the chain", () => {
  it("an untouched log verifies against its anchored heads", () => {
    const l = build(); const v = l.verify(anchorsOf(l));
    expect(v.ok).toBe(true); expect(v.entries).toBe(4); expect(v.anchored).toBe(4); expect(v.problems).toEqual([]);
  });
  it("each entry commits to the previous one", () => {
    const l = build(); expect(l.entries[1].prevHash).toBe(l.entries[0].hash); expect(l.entries[3].prevHash).toBe(l.entries[2].hash);
  });
  it("EDITING a past entry (to hide who did it) is caught and pinpointed", () => {
    const l = build(); const anchors = anchorsOf(l);
    l.entries[2].actorLabel = "Registry admin"; l.entries[2].outcome = "ok";
    const v = l.verify(anchors);
    expect(v.ok).toBe(false); expect(v.firstBad).toBe(3);
    expect(v.problems.some((p) => p.seq === 3 && p.kind === "entry-edited")).toBe(true);
    expect(v.lastGood).toBe(2); expect(v.lastGoodAnchor!.seq).toBe(2); // the last entry still proven good, with its block and time
  });
  it("an attacker who RECOMPUTES every hash after editing is still caught, because the chain holds the original heads", () => {
    const l = build(); const anchors = anchorsOf(l);
    l.entries[1].actorLabel = "Someone else"; // edit...
    let prev = l.entries[0].hash;
    for (let i = 1; i < l.entries.length; i++) { const { hash, ...rest } = l.entries[i]; const fixed = { ...rest, prevHash: prev }; l.entries[i] = { ...fixed, hash: hashEntry(fixed) }; prev = l.entries[i].hash; } // ...and re-hash everything
    const v = l.verify(anchors);
    expect(v.ok).toBe(false);
    expect(v.problems.every((p) => p.kind === "anchor-mismatch")).toBe(true); // internally consistent, but contradicts the anchored heads
    expect(v.firstBad).toBe(2); expect(v.problems[0].anchor!.block).toBe(12);
  });
  it("DELETING an entry is caught (an anchored entry is missing)", () => {
    const l = build(); const anchors = anchorsOf(l); l.entries.pop();
    const v = l.verify(anchors);
    expect(v.ok).toBe(false); expect(v.problems.some((p) => p.kind === "entry-missing" && p.seq === 4)).toBe(true);
  });
  it("REORDERING entries is caught", () => {
    const l = build(); const anchors = anchorsOf(l); [l.entries[1], l.entries[2]] = [l.entries[2], l.entries[1]];
    expect(l.verify(anchors).ok).toBe(false);
  });
  it("TRUNCATING the tail is caught", () => {
    const l = build(); const anchors = anchorsOf(l); l.entries.length = 2;
    const v = l.verify(anchors); expect(v.ok).toBe(false); expect(v.problems.map((p) => p.seq)).toEqual([3, 4]);
  });
  it("an entry written but never anchored (chain was down) is not flagged as tampering", () => {
    const l = build(); const anchors = anchorsOf(l).slice(0, 3); // last head never reached the chain
    expect(l.verify(anchors).ok).toBe(true);
  });
});

describe("signed request format", () => {
  it("binds method, path, body hash, nonce and timestamp", () => {
    const m = requestMessage("post", "/api/demo/declare", "ab".repeat(32), "n1", 1700000000000);
    expect(m.split("\n")).toEqual(["sovereign-proof:v1", "POST", "/api/demo/declare", "ab".repeat(32), "n1", "1700000000000"]);
  });
  it("changing any bound field changes the signed text (so a signature cannot be reused for another action)", () => {
    const base = requestMessage("POST", "/a", "h", "n", 1);
    for (const other of [requestMessage("GET", "/a", "h", "n", 1), requestMessage("POST", "/b", "h", "n", 1), requestMessage("POST", "/a", "x", "n", 1), requestMessage("POST", "/a", "h", "m", 1), requestMessage("POST", "/a", "h", "n", 2)]) expect(other).not.toBe(base);
  });
  it("canonical JSON is key-order independent (client and server hash the same body)", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(canonical({ a: [2, { d: 1 }], b: 1 }));
  });
});
