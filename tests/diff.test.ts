import { describe, it, expect } from "vitest";
import { diffJson, diffStatus } from "../packages/core/diff";
import { buildCrypto } from "../packages/core/crypto";
import { buildStatusList } from "../packages/core/status";

describe("readable diffs (the 'what was the previous value' evidence)", () => {
  it("names the exact field that changed in a registry, labelled by issuer", () => {
    const a = { issuers: [{ issuerId: "uni-x", keys: [{ epoch: 1, status: "active" }] }] };
    const b = { issuers: [{ issuerId: "uni-x", keys: [{ epoch: 1, status: "compromised" }] }] };
    expect(diffJson(a, b)).toEqual([{ path: "issuers[uni-x].keys[epoch 1].status", from: "active", to: "compromised" }]);
  });
  it("reports an injected issuer and a removed field", () => {
    const d = diffJson({ issuers: [{ issuerId: "a" }] }, { issuers: [{ issuerId: "a" }, { issuerId: "evil" }] });
    expect(d.some((c) => c.path.startsWith("issuers[evil]") && c.from === "(absent)")).toBe(true);
    expect(diffJson({ x: 1, y: 2 }, { x: 1 })).toEqual([{ path: "y", from: "2", to: "(absent)" }]);
  });
  it("is empty for identical documents", () => { expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]); });
  it("lists which credential SLOTS changed between status lists, never who they belong to", async () => {
    const c = await buildCrypto(), k = c.keyFromSeed("t");
    const v1 = buildStatusList(c, k.prv, "1", 1, 64, [], "x"), v2 = buildStatusList(c, k.prv, "1", 2, 64, [3, 9], "x");
    expect(diffStatus(v1, v2)).toEqual([{ path: "slot #3", from: "not revoked", to: "REVOKED" }, { path: "slot #9", from: "not revoked", to: "REVOKED" }]);
    expect(diffStatus(v2, v1).every((x) => x.to === "not revoked")).toBe(true);
  });
});
