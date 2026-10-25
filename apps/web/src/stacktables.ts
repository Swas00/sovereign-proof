/**
 * Presentation-only progressive enhancement: copies each column header onto its cells (data-label) so that, on narrow screens,
 * wide tables can render as labelled cards (see styles.css). It never changes content or React state. Roles are set so that
 * assistive technology still announces a table when the CSS changes the element display types.
 */
const MIN_COLUMNS = 4;

function enhance(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll<HTMLElement>("thead th")];
  if (heads.length < MIN_COLUMNS) return;
  const labels = heads.map((h) => h.textContent?.trim() ?? "");
  if (!table.classList.contains("stackable")) {
    table.classList.add("stackable");
    table.setAttribute("role", "table");
    table.querySelector("thead")?.setAttribute("role", "rowgroup");
    table.querySelector("thead tr")?.setAttribute("role", "row");
    heads.forEach((h) => h.setAttribute("role", "columnheader"));
  }
  for (const body of table.tBodies) {
    body.setAttribute("role", "rowgroup");
    for (const row of body.rows) {
      if (row.getAttribute("role") !== "row") row.setAttribute("role", "row");
      [...row.cells].forEach((cell, i) => {
        if (cell.dataset.label !== labels[i]) { cell.dataset.label = labels[i] ?? ""; cell.setAttribute("role", "cell"); }
      });
    }
  }
}

export function installStackTables() {
  if (typeof document === "undefined") return;
  let queued = 0;
  const run = () => { queued = 0; document.querySelectorAll<HTMLTableElement>(".tablewrap table").forEach(enhance); };
  const schedule = () => { if (!queued) queued = requestAnimationFrame(run); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
