export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `request failed (${r.status})`);
  return j;
}
