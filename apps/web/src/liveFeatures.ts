import { useEffect, useState } from "react";

/** The slice of GET /api/public that the landing diagrams read. Public, signed or count-only data: no holder values. */
interface PublicState {
  registry: { body: { version: number } };
  keyStatus: { issuerId: string; keyId: string; status: string; compromise?: { windowStart: string } }[];
  anchors: { issuerKeyId: string; leafCount: number; anchoredAt: string }[];
  revokedSlots: Record<string, number>;
  audit: { auditId: string; verdict: string }[];
  events: unknown[];
  summary?: { trustedAnchors: number; suspectAnchors: number };
}

/** Polls the public endpoint. `null` means the API is unreachable, so callers fall back to static copy. */
export function usePublicState(intervalMs = 4000): PublicState | null {
  const [state, setState] = useState<PublicState | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      if (document.hidden) return;
      fetch("/api/public")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => alive && setState(j))
        .catch(() => alive && setState(null));
    };
    pull();
    const t = setInterval(pull, intervalMs);
    document.addEventListener("visibilitychange", pull);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", pull); };
  }, [intervalMs]);
  return state;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
// The API only returns the most recent entries (30 verifications, 40 events); never present a capped count as exact.
const capped = (n: number, cap: number, one: string) => (n >= cap ? `${cap}+ ${one}s` : plural(n, one));

/** Maps live registry / notary / audit state onto the feature section's props. */
export function liveFeatureProps(pub: PublicState) {
  const issuerOf = Object.fromEntries(pub.keyStatus.map((k) => [k.keyId, k.issuerId]));
  const logSize: Record<string, number> = {};
  for (const a of pub.anchors) {
    const id = issuerOf[a.issuerKeyId] ?? "unknown";
    logSize[id] = Math.max(logSize[id] ?? 0, a.leafCount);
  }
  const sum = (...ids: string[]) => ids.reduce((n, id) => n + (logSize[id] ?? 0), 0);
  const proofs = pub.audit.length;
  const last = pub.audit[proofs - 1];

  // chart: every notarized anchor in time order; y = anchors notarized so far (always rising, so the shape is never misread as a log shrinking)
  const anchors = [...pub.anchors].sort((a, b) => Date.parse(a.anchoredAt) - Date.parse(b.anchoredAt));
  const bad = pub.keyStatus.find((k) => k.status === "compromised" && k.compromise);
  const windowStart = bad ? Date.parse(bad.compromise!.windowStart) : NaN;
  // same rule the verifier applies: only the compromised key's anchors after the window opened are quarantined
  const quarantined = (a: (typeof anchors)[number]) => !!bad && a.issuerKeyId === bad.keyId && Date.parse(a.anchoredAt) > windowStart;
  const firstInWindow = anchors.findIndex((a) => !Number.isNaN(windowStart) && Date.parse(a.anchoredAt) > windowStart);
  const labels = anchors.map((a) => `${issuerOf[a.issuerKeyId] ?? "?"} · ${plural(a.leafCount, "entry", "entries")} · ${quarantined(a) ? "quarantined" : "anchored"}`);
  const nQuarantined = anchors.filter(quarantined).length;

  const revoked = Object.values(pub.revokedSlots).reduce((n, v) => n + v, 0);
  const logs = Object.keys(logSize).length;

  return {
    tag: "How it works · live data",
    flow: {
      people: [
        `Universities · ${sum("uni-x", "uni-y")} logged`,
        `Medical board · ${sum("med-board")} logged`,
        `Identity authority · ${sum("gov-id")} logged`,
        `Employers · ${capped(proofs, 30, "proof")} checked`,
        `Auditor · ${capped(pub.events.length, 40, "event")} logged`,
      ],
      sheetLabel: last ? `ZK PROOF · ${last.verdict.toUpperCase()}` : "ZK PROOF · AWAITING",
      tick: last?.auditId ?? "none",
    },
    integrations: {
      tools: [`Registry v${pub.registry.body.version}`, `Notary · ${plural(pub.anchors.length, "anchor")}`, `Issuer logs · ${logs}`, `Status · ${revoked} revoked`],
      status: `v${pub.registry.body.version} · ${plural(pub.keyStatus.length, "key")}`,
    },
    insights: anchors.length >= 2
      ? {
          title: "Incident-aware trust",
          description: bad
            ? `${bad.issuerId}'s key is declared compromised. ${plural(anchors.length - nQuarantined, "notarized anchor")} stay trusted; ${plural(nQuarantined, "anchor")} inside the theft window ${nQuarantined === 1 ? "is" : "are"} quarantined.`
            : `${plural(anchors.length, "notarized anchor")} across ${plural(logs, "issuer log")}. If a key is declared compromised, only its anchors inside the theft window are quarantined.`,
          values: anchors.map((_, i) => i + 1),
          labels,
          forecastFrom: firstInWindow < 0 ? anchors.length - 1 : firstInWindow,
          splitLabel: bad && firstInWindow >= 0 ? "WINDOW OPENS" : "",
        }
      : undefined,
  };
}
