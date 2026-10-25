import type { KeyObject } from "node:crypto";
import { publishNext, type CompromiseRecord, type IssuerKey, type SignedRegistry } from "./registry";
import { verifyAnchor, type Anchor } from "./notary";

export type EvidenceDecision =
  | { decision: "preserved"; detail: string }
  | { decision: "quarantined"; detail: string }
  | { decision: "unlogged"; detail: string };

/**
 * Incident policy for a credential signed by a key that is now declared compromised.
 * We never trust the credential's own timestamp (the attacker controls it). Instead we need a NOTARIZED
 * anchor of an issuance-log root that (a) contains the credential and (b) was timestamped by the notary
 * at or before the earliest time the key could have been stolen (windowStart).
 */
export function evaluateEvidence(
  keyId: string, root: bigint, anchors: Anchor[], notaryPub: KeyObject, rec: CompromiseRecord | undefined,
): EvidenceDecision {
  const hit = anchors.find((a) => a.issuerKeyId === keyId && a.root === root.toString() && verifyAnchor(a, notaryPub));
  if (!hit) return { decision: "unlogged", detail: "proof's issuance-log root has no valid notary anchor for this key" };
  if (!rec) return { decision: "preserved", detail: `log root notarized ${hit.anchoredAt}` };
  if (Date.parse(hit.anchoredAt) <= Date.parse(rec.windowStart))
    return { decision: "preserved", detail: `credential is in a log root the notary timestamped ${hit.anchoredAt}, before the compromise window opened (${rec.windowStart})` };
  return { decision: "quarantined", detail: `its log root was anchored ${hit.anchoredAt}, inside/after the compromise window (${rec.windowStart}); a thief with the key could have produced it` };
}

/** Privacy-safe incident summary: counts and times only, never holders or commitments. */
export function incidentSummary(keyId: string, rec: CompromiseRecord, anchors: Anchor[], notaryPub: KeyObject) {
  const mine = anchors.filter((a) => a.issuerKeyId === keyId && verifyAnchor(a, notaryPub));
  const before = mine.filter((a) => Date.parse(a.anchoredAt) <= Date.parse(rec.windowStart));
  const latestTrusted = before.sort((a, b) => b.leafCount - a.leafCount)[0];
  return {
    trustedAnchors: before.length,
    suspectAnchors: mine.length - before.length,
    legacyCredentialsProtected: latestTrusted?.leafCount ?? 0, // count of entries covered by the last trusted anchor
    lastTrustedAnchor: latestTrusted?.anchoredAt,
  };
}

export interface CompromiseDeclaration {
  issuerId: string; keyId: string; windowStart: string; windowEnd: string; reason: string; replacementKey: IssuerKey;
}
/** Publishes the next signed registry version: old key -> compromised (with window), replacement key (epoch+1) -> active. */
export function declareCompromise(prev: SignedRegistry, d: CompromiseDeclaration, adminPriv: KeyObject, at: string): SignedRegistry {
  return publishNext(prev, (b) => {
    const iss = b.issuers.find((i) => i.issuerId === d.issuerId);
    const key = iss?.keys.find((k) => k.keyId === d.keyId);
    if (!iss || !key) throw new Error("unknown issuer/key");
    key.status = "compromised";
    key.compromise = { windowStart: d.windowStart, windowEnd: d.windowEnd, reason: d.reason };
    iss.keys.push(d.replacementKey);
    b.note = `incident: ${d.issuerId} key epoch ${key.epoch} compromised`;
  }, adminPriv, at);
}
