import { useEffect, useRef, useState } from "react";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";
import InkOrbitFeatures from "@/components/ui/ink-orbit-features";
import { liveFeatureProps, usePublicState } from "./liveFeatures";
import { toggleTheme, useTheme } from "./theme";

/**
 * Adaptive quality: the sculpture simulates ~100k particles on the GPU. Rather than guess which devices can keep up, measure
 * real frame times while the visitor is interacting and drop to the static image as soon as it cannot hold ~25 fps. It starts at a
 * lower density on phones and low-core devices. Nothing else on the page depends on it.
 * Changing the particle count rebuilds every particle, which is itself a multi-second stall on a weak device, so the governor never
 * steps through intermediate densities: it goes straight to the static image, which costs nothing.
 */
const DENSITY = [1, 0.5, 0.5, 0.5];
const STATIC = 3;

/** True when the browser is rendering WebGL in software (no real GPU): a 100k-particle simulation would stall the page for seconds. */
function softwareRenderer(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false; // no WebGL at all: the component already shows the static image
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { return false; }
}
function useHeroQuality() {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const weak = typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || (nav?.hardwareConcurrency ?? 8) <= 4 || (nav?.deviceMemory ?? 8) <= 4);
  // ?hero=full skips the software-renderer check (used to test the frame-time governor on a machine without a GPU)
  const software = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hero") !== "full" && softwareRenderer();
  const [tier, setTier] = useState(software ? STATIC : weak ? 1 : 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let activeUntil = 0, last = 0, raf = 0;
    const dts: number[] = [];
    const loop = (t: number) => {
      raf = 0;
      if (t >= activeUntil) { last = 0; return; }
      if (last) {
        dts.push(t - last); if (dts.length > 12) dts.shift();
        if (dts.length >= 6 && [...dts].sort((a, b) => a - b)[dts.length >> 1] > 45) { setTier(STATIC); dts.length = 0; }
      }
      last = t; raf = requestAnimationFrame(loop);
    };
    const onMove = () => { activeUntil = performance.now() + 600; if (!raf) raf = requestAnimationFrame(loop); };
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => { el.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return { ref, tier, density: DENSITY[tier], interactive: tier < STATIC };
}

export default function Landing() {
  const quality = useHeroQuality();
  // live data from the running API; null (unreachable) falls back to the static copy below
  const theme = useTheme();
  const pub = usePublicState();
  const live = pub ? liveFeatureProps(pub) : null;
  return (
    <>
      {/* The hero keeps its own switch; clicks on it also flip the site-wide theme, and the hero follows `theme` back. */}
      <div ref={quality.ref} data-hero-quality={quality.tier} onClick={(e) => { if ((e.target as HTMLElement).closest(".sh-theme")) toggleTheme(); }}>
      <SculptureHero
        brand="Sovereign Proof"
        navLinks={[
          { label: "Verify", href: "#app/verify" },
          { label: "Wallet", href: "#app/wallet" },
          { label: "Trust & incident", href: "#app/trust" },
          { label: "Issue", href: "#app/issue" },
          { label: "Audit", href: "#app/audit" },
        ]}
        navCta={{ label: "Launch demo", href: "#app/verify" }}
        eyebrow="Theme 4 · Decentralized portable proofs"
        headline={"Prove it without\nexposing it."}
        headlineAccent="exposing it."
        body="Hold your own credentials. Prove a degree, an age and a license in one zero-knowledge proof, and keep every honest credential valid even when an issuer's key is stolen."
        primaryCta={{ label: "Launch the demo", href: "#app/verify" }}
        secondaryCta={{ label: "See the key-compromise recovery", href: "#app/trust" }}
        hint="Move across the form"
        hintTouch="Touch the form"
        backdropText="proof"
        theme={theme}
        background="#E9E6E0"
        darkBackground="#121211"
        src="/hero/light.webp"
        darkSrc="/hero/dark.webp"
        mobileSrc="/hero/mobile-light.webp"
        mobileDarkSrc="/hero/mobile-dark.webp"
        imageAlt="Abstract sculpture of interwoven metallic filaments and particles"
        loadFonts={false}
      particleDensity={quality.density}
      interactive={quality.interactive}
      height="max(100svh, 700px)" /* short screens (landscape phones) scroll instead of crushing the sculpture */
      />
      </div>
      <div className="landing-features">
        <InkOrbitFeatures
          theme={theme}
          brand="Sovereign Proof"
          tag={live?.tag ?? "How it works"}
          title={"Prove the *claim,*\nnot the person."}
          collaboration={{
            title: "Issue once, verify anywhere",
            description: "Institutions sign credentials into the holder's wallet. Verifiers check them locally against a signed registry, with no call back to the issuer.",
          }}
          reports={{
            title: "One zero-knowledge proof",
            description: "A degree, an age and an active license are proven together. Names, birth dates and addresses never leave the holder's device.",
          }}
          integrations={{
            title: "Four public, signed sources",
            description: "Trust registry, on-chain anchors, issuer logs and status lists. A verifier needs nothing else, and none of it names a holder.",
            tools: live?.integrations.tools ?? ["Registry", "Chain", "Issuer log", "Status list"],
            status: live?.integrations.status,
          }}
          insights={
            live?.insights ?? {
              title: "Incident-aware trust",
              description: "When a university's key is stolen, credentials anchored on the chain before the theft window stay valid, and anything issued inside it is quarantined.",
              values: [8, 12, 15, 19, 22, 26, 29, 31, 33, 38, 41, 45],
              forecastFrom: 8,
            }
          }
          flow={live?.flow}
        />
      </div>
    </>
  );
}
