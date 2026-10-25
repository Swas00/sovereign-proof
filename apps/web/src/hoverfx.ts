/**
 * Position-aware hover effects for the whole site, driven by ONE pointer listener.
 * It only writes CSS custom properties (--mx/--my cursor position, --fxd diameter, --tx/--ty magnetic pull,
 * --tiltx/--tilty card tilt, --rx/--ry ripple origin); every visual lives in styles.css.
 * It never touches app state, handlers or markup. Off for touch/coarse pointers. With reduced motion it only reports the cursor
 * position (for the static, cursor-following light); the moving effects (magnetic pull, tilt, ring, ripple) stay off.
 */
const TRACK = [
  ".btn", ".card", ".cred", ".themebtn", ".brandlink", "header nav button", "tbody tr", "ol.steps li", "ul.clean li", ".verdict", ".timeline div",
  ".sh-btn", ".sh-navcta", ".sh-link", ".sh-txt", ".sh-theme", ".ib-card",
].join(",");
const MAGNET = ".btn, .themebtn, header nav button, .sh-btn, .sh-navcta, .sh-theme";
const RIPPLE = ".btn, .themebtn, .sh-btn, .sh-navcta"; // only elements that clip their overflow
const TILT = ".cred";
const INTERACTIVE = "a[href], button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea, [role=button], label, summary";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function installHoverFx() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!fine.matches) return;

  // cursor ring + dot (pure decoration, pointer-events: none, hidden by CSS unless motion is allowed)
  const ring = document.createElement("div"); ring.id = "fx-ring"; ring.setAttribute("aria-hidden", "true");
  const dot = document.createElement("div"); dot.id = "fx-dot"; dot.setAttribute("aria-hidden", "true");
  document.body.append(ring, dot);

  let tx = -100, ty = -100, rx = -100, ry = -100, loop = 0, move: PointerEvent | null = null, queued = 0;
  const tracked = new Set<HTMLElement>();

  const reset = (el: HTMLElement) => ["--tx", "--ty", "--tiltx", "--tilty"].forEach((p) => el.style.removeProperty(p));

  function apply(e: PointerEvent, calm: boolean) {
    const chain: HTMLElement[] = [];
    for (let n = e.target as HTMLElement | null; n && n !== document.body && chain.length < 5; n = n.parentElement) if (n.matches?.(TRACK)) chain.push(n);
    for (const el of chain) {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      el.style.setProperty("--mx", x.toFixed(1) + "px");
      el.style.setProperty("--my", y.toFixed(1) + "px");
      el.style.setProperty("--fxd", (Math.hypot(r.width, r.height) * 2.1).toFixed(0) + "px");
      if (!calm && el.matches(MAGNET)) {
        el.style.setProperty("--tx", clamp((x - r.width / 2) * 0.16, -6, 6).toFixed(2) + "px");
        el.style.setProperty("--ty", clamp((y - r.height / 2) * 0.22, -4, 4).toFixed(2) + "px");
      }
      if (!calm && el.matches(TILT)) {
        el.style.setProperty("--tiltx", (-(y / r.height - 0.5) * 9).toFixed(2) + "deg");
        el.style.setProperty("--tilty", ((x / r.width - 0.5) * 9).toFixed(2) + "deg");
      }
      tracked.add(el);
    }
    for (const el of tracked) if (!chain.includes(el)) { reset(el); tracked.delete(el); } // pointer left: spring back
    const hot = !!(e.target as HTMLElement | null)?.closest?.(INTERACTIVE);
    ring.dataset.hover = hot ? "1" : "0";
  }

  function frame() {
    rx += (tx - rx) * 0.2; ry += (ty - ry) * 0.2;
    ring.style.transform = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
    loop = Math.abs(tx - rx) + Math.abs(ty - ry) > 0.2 ? requestAnimationFrame(frame) : 0;
  }

  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    dot.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    ring.dataset.on = "1"; dot.dataset.on = "1";
    if (!loop) loop = requestAnimationFrame(frame);
    move = e;
    if (!queued) queued = requestAnimationFrame(() => { queued = 0; if (move) apply(move, reduce.matches); });
  }, { passive: true });

  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || reduce.matches) return;
    ring.dataset.down = "1";
    const el = (e.target as HTMLElement | null)?.closest?.(RIPPLE) as HTMLElement | null;
    if (el && !(el as HTMLButtonElement).disabled) {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", e.clientX - r.left + "px");
      el.style.setProperty("--ry", e.clientY - r.top + "px");
      el.classList.remove("fx-ripple"); void el.offsetWidth; el.classList.add("fx-ripple");
      el.addEventListener("animationend", (a) => { if ((a as AnimationEvent).animationName === "fx-ripple") el.classList.remove("fx-ripple"); }, { once: true });
    }
  }, { passive: true });
  addEventListener("pointerup", () => { ring.dataset.down = "0"; }, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => {
    ring.dataset.on = "0"; dot.dataset.on = "0";
    tracked.forEach(reset); tracked.clear();
  });
}
