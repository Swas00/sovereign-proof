import { verifyMessage } from "ethers";
import type { Request } from "express";
import { canonical } from "../core/canonical";
import { sha256hex } from "../core/registry";
import { MAX_SKEW_MS, requestMessage } from "../core/signing";

export class AuthError extends Error { constructor(public status: 401 | 403, message: string, public actor?: string) { super(message); } }

const seen = new Map<string, number>(); // nonce -> expiry (replay protection)

/** Verifies the EIP-191 signature on a privileged request and returns the signer's address. Never trusts a claimed identity. */
export function authenticate(req: Request): string {
  const h = (n: string) => req.header(n);
  const claimed = h("x-actor"), nonce = h("x-nonce"), ts = Number(h("x-timestamp")), sig = h("x-signature");
  if (!claimed || !nonce || !sig || !Number.isFinite(ts)) throw new AuthError(401, "unsigned request: privileged actions require a signature from an authorised account");
  if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) throw new AuthError(401, "request timestamp is outside the allowed window", claimed);
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  if (seen.has(nonce)) throw new AuthError(401, "replayed request: this nonce was already used", claimed);
  let recovered: string;
  try { recovered = verifyMessage(requestMessage(req.method, req.path, sha256hex(canonical(req.body ?? {})), nonce, ts), sig); }
  catch { throw new AuthError(401, "malformed signature", claimed); }
  if (recovered.toLowerCase() !== claimed.toLowerCase()) throw new AuthError(401, "signature does not match the claimed account", claimed);
  seen.set(nonce, now + MAX_SKEW_MS * 2);
  return recovered;
}
