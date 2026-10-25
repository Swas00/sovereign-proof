import { canonical } from "./canonical";

/**
 * A verification receipt: the public outcome of one verification, small enough to hash and anchor from a verifier's own wallet.
 * It holds the audit id, verdict, per-step outcomes and the registry version used. No credential data, names or proofs.
 * Pure (no crypto import): callers hash `receiptText(...)` with SHA-256 (server: sha256hex, browser: ethers sha256).
 */
export interface ReceiptInput { auditId: string; verdict: string; steps: { id: string; outcome: string }[]; registryVersion: number }
export const receiptText = (r: ReceiptInput): string =>
  canonical({ v: 1, auditId: r.auditId, verdict: r.verdict, steps: r.steps.map((s) => `${s.id}:${s.outcome}`), registryVersion: r.registryVersion });
