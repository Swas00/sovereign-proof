import { describe, it, expect, beforeAll } from "vitest";
import { buildCrypto, CRED_TYPE, type Crypto, type CredentialFields } from "../packages/core/crypto";

let c: Crypto;
beforeAll(async () => { c = await buildCrypto(); });

const fields = (c: Crypto): CredentialFields => ({
  type: CRED_TYPE.ID, holderId: c.holderId(42n), a1: 19950315n, a2: 0n, statusIndex: 7n, salt: 123456789n,
});

describe("crypto", () => {
  it("is deterministic for seeded keys", () => {
    expect(c.keyFromSeed("uni").pub).toEqual(c.keyFromSeed("uni").pub);
    expect(c.keyFromSeed("uni").pub).not.toEqual(c.keyFromSeed("other").pub);
  });
  it("verifies a valid issuer signature", () => {
    const k = c.keyFromSeed("uni"); const m = c.commitment(fields(c));
    expect(c.verify(m, c.sign(k.prv, m), k.pub)).toBe(true);
  });
  it("rejects a signature from a different key", () => {
    const k = c.keyFromSeed("uni"), evil = c.keyFromSeed("evil"); const m = c.commitment(fields(c));
    expect(c.verify(m, c.sign(evil.prv, m), k.pub)).toBe(false);
  });
  it("rejects a tampered credential (changed dob)", () => {
    const k = c.keyFromSeed("uni"); const f = fields(c);
    const sig = c.sign(k.prv, c.commitment(f));
    expect(c.verify(c.commitment({ ...f, a1: 20100315n }), sig, k.pub)).toBe(false);
  });
});
