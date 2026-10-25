/**
 * Signed requests: every privileged API call carries an EIP-191 signature from an authorised account, so each write is
 * attributable to a key. This module is pure (no crypto library) so the server, the browser and scripts share one format.
 */
export const SIGNING_VERSION = "sovereign-proof:v1";
export const MAX_SKEW_MS = 120_000;

/** The exact text an actor signs. It binds the method, path, body, a one-time nonce and a timestamp (replay protection). */
export function requestMessage(method: string, path: string, bodySha256: string, nonce: string, timestamp: number): string {
  return [SIGNING_VERSION, method.toUpperCase(), path, bodySha256, nonce, String(timestamp)].join("\n");
}

/**
 * Local-development keys ONLY. These are the Hardhat node's publicly documented test accounts: anyone can derive them, and
 * they must never hold value or be reused anywhere real. A production actor keeps its key in its own wallet or HSM.
 */
export const DEMO_KEYS: Record<string, string> = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "gov-id": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "uni-x": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "uni-y": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "med-board": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  stranger: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
};
export type ActorRole = keyof typeof DEMO_KEYS;
