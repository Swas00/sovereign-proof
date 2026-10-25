import { canonical } from "../../../packages/core/canonical";
import { DEMO_KEYS, requestMessage, type ActorRole } from "../../../packages/core/signing";

// crypto.subtle and crypto.randomUUID exist only on HTTPS or localhost; this must also work when the site is opened over plain http on a
// local network, so hashing uses the ethers library and the nonce uses getRandomValues (available everywhere).
const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * POST a privileged action signed by `role`'s key (EIP-191). The server recovers the signer from the signature and checks the
 * role; nothing in the request is trusted on its own say-so. The keys are the local node's public test accounts (see signing.ts).
 * `role: null` sends the request unsigned, which the server must refuse and log.
 */
export async function signedPost<T = any>(path: string, body: unknown, role: ActorRole | null): Promise<T> {
  const payload = body ?? {};
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    const { Wallet, sha256, toUtf8Bytes } = await import("ethers"); // loaded only when something is actually signed
    const wallet = new Wallet(DEMO_KEYS[role]);
    const nonce = randomHex(16), ts = Date.now();
    const sha = sha256(toUtf8Bytes(canonical(payload))).slice(2); // same SHA-256 hex the server computes
    headers["x-actor"] = wallet.address; headers["x-nonce"] = nonce; headers["x-timestamp"] = String(ts);
    headers["x-signature"] = await wallet.signMessage(requestMessage("POST", path, sha, nonce, ts));
  }
  const r = await fetch(path, { method: "POST", headers, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `request failed (${r.status})`), { status: r.status });
  return j;
}

/** Which account must sign each privileged route when a button in the UI triggers it. */
export const ROUTE_ROLE: Record<string, ActorRole> = {
  "/api/demo/declare": "admin",
  "/api/demo/restore": "admin",
  "/api/demo/revoke-license": "med-board",
  "/api/demo/reissue": "uni-x",
};
