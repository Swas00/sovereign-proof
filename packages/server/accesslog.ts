import { canonical } from "../core/canonical";
import { sha256hex } from "../core/registry";
import type { AuditHead } from "./chain";

/**
 * Hash-chained access log. Every write attempt (accepted or denied) becomes an entry whose hash covers its content AND the
 * previous entry's hash. After each entry the server anchors the head on the chain, so rewriting, deleting or reordering
 * history contradicts a record nobody on the server can edit.
 */
export interface LogEntry {
  seq: number; time: string; actor: string; actorLabel: string; method: string; path: string; bodySha256: string;
  outcome: "ok" | "denied" | "error"; detail: string; prevHash: string; hash: string;
}
const ZERO = "0".repeat(64);
export const hashEntry = (e: Omit<LogEntry, "hash">) => sha256hex(canonical(e));

export class AccessLog {
  entries: LogEntry[] = [];
  get head() { return this.entries.length ? this.entries[this.entries.length - 1].hash : ZERO; }
  append(e: Omit<LogEntry, "seq" | "prevHash" | "hash">): LogEntry {
    const base = { ...e, seq: this.entries.length + 1, prevHash: this.head };
    const entry: LogEntry = { ...base, hash: hashEntry(base) };
    this.entries.push(entry);
    return entry;
  }

  /** Recompute the whole chain and compare it with what was anchored on the chain. */
  verify(anchored: AuditHead[]) {
    type Problem = { seq: number; kind: string; detail: string; anchor?: { block: number; tx: string; time: string } };
    const problems: Problem[] = [];
    let prev = ZERO;
    for (const e of this.entries) {
      const { hash, ...rest } = e;
      if (hashEntry(rest) !== hash) problems.push({ seq: e.seq, kind: "entry-edited", detail: "the entry's content no longer matches its own hash" });
      if (e.prevHash !== prev) problems.push({ seq: e.seq, kind: "link-broken", detail: "the entry does not follow the previous entry's hash" });
      prev = hash;
    }
    for (const a of anchored) {
      const e = this.entries[a.seq - 1];
      const anchor = { block: a.blockNumber, tx: a.txHash, time: a.time };
      if (!e) problems.push({ seq: a.seq, kind: "entry-missing", detail: "an entry that was anchored on the chain is no longer in the log (deleted or truncated)", anchor });
      else if (e.hash !== a.head) problems.push({ seq: a.seq, kind: "anchor-mismatch", detail: "the entry differs from the head that was anchored on the chain when it was written", anchor });
    }
    const bad = new Set(problems.map((p) => p.seq));
    const firstBad = bad.size ? Math.min(...bad) : undefined;
    const lastGood = firstBad === undefined ? this.entries.length : firstBad - 1;
    const lastGoodAnchor = [...anchored].reverse().find((a) => a.seq <= lastGood);
    return { ok: problems.length === 0, entries: this.entries.length, anchored: anchored.length, problems: problems.sort((a, b) => a.seq - b.seq), firstBad, lastGood,
      lastGoodAnchor: lastGoodAnchor ? { seq: lastGoodAnchor.seq, block: lastGoodAnchor.blockNumber, tx: lastGoodAnchor.txHash, time: lastGoodAnchor.time } : undefined };
  }
}
