import type { StatusList } from "./status";

export interface Change { path: string; from: string; to: string }
const show = (v: unknown) => (v === undefined ? "(absent)" : typeof v === "string" ? v : JSON.stringify(v));

/** Readable deep diff of two JSON documents. Arrays of objects with an `issuerId` / `keyId` are labelled by it. */
export function diffJson(a: unknown, b: unknown, path = "", out: Change[] = []): Change[] {
  if (out.length >= 40) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    const label = (x: any, i: number) => (x && typeof x === "object" ? x.issuerId ?? (x.epoch !== undefined ? `epoch ${x.epoch}` : undefined) : undefined) ?? String(i);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diffJson(a[i], b[i], `${path}[${label(a[i] ?? b[i], i)}]`, out);
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) diffJson((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  out.push({ path: path || "(document)", from: show(a), to: show(b) });
  return out;
}

const slots = (l: StatusList) => {
  const bytes = Buffer.from(l.bits, "base64"), s: number[] = [];
  for (let i = 0; i < l.size; i++) if ((bytes[i >> 3] >> (i & 7)) & 1) s.push(i);
  return s;
};
/** Which credential slots changed between two status lists (slot numbers are public, they name no holder). */
export function diffStatus(a: StatusList, b: StatusList): Change[] {
  const sa = new Set(slots(a)), sb = new Set(slots(b)), out: Change[] = [];
  for (const i of sb) if (!sa.has(i)) out.push({ path: `slot #${i}`, from: "not revoked", to: "REVOKED" });
  for (const i of sa) if (!sb.has(i)) out.push({ path: `slot #${i}`, from: "REVOKED", to: "not revoked" });
  return out;
}
