/** Deterministic JSON: sorted keys, undefined dropped. Pure, so the browser, server and scripts hash identically. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
