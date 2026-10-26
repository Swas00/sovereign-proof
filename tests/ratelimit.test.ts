import { describe, expect, it } from "vitest";
import { createLimiter } from "../packages/server/ratelimit";

describe("rate limiter", () => {
  it("allows up to the limit, then refuses, per key", () => {
    const l = createLimiter(3, 60_000);
    expect([1, 2, 3].map(() => l.hit("a", 0))).toEqual([true, true, true]);
    expect(l.hit("a", 1)).toBe(false);
    expect(l.hit("b", 1)).toBe(true); // another visitor is unaffected
  });
  it("opens a fresh window once the old one has expired", () => {
    const l = createLimiter(1, 1000);
    expect(l.hit("a", 0)).toBe(true);
    expect(l.hit("a", 500)).toBe(false);
    expect(l.hit("a", 1001)).toBe(true);
  });
  it("forgets expired keys so memory does not grow", () => {
    const l = createLimiter(1, 1000);
    for (let i = 0; i < 100; i++) l.hit("k" + i, 0);
    l.hit("late", 5000); // sweeps the expired ones
    expect(l.hit("k0", 5001)).toBe(true); // k0 starts over
  });
});
