import type { NextFunction, Request, Response } from "express";

/** Fixed-window counter per key. Pure (the clock is passed in) so it can be tested without waiting. */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    /** True if this request is allowed. */
    hit(key: string, now: number): boolean {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); // keeps the map from growing without bound
      const cur = hits.get(key);
      if (!cur) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
      cur.n += 1;
      return cur.n <= max;
    },
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Express middleware: at most `max` POSTs per `windowMs` per client address. Requests from this computer are exempt (local development). */
export function rateLimit(max: number, windowMs: number, scope: string) {
  const lim = createLimiter(max, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST" || LOOPBACK.has(req.ip ?? "")) return next();
    if (lim.hit(`${scope}:${req.ip}`, Date.now())) return next();
    res.set("Retry-After", String(Math.ceil(windowMs / 1000))).status(429).json({ error: "too many requests: slow down and try again in a minute" });
  };
}
