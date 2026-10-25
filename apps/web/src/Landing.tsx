import SculptureHero from "@/components/ui/liquid-sculpture-hero";

const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export default function Landing() {
  return (
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
      theme={prefersDark ? "dark" : "light"}
      background="#E9E6E0"
      darkBackground="#121211"
      src="/hero/light.webp"
      darkSrc="/hero/dark.webp"
      mobileSrc="/hero/mobile-light.webp"
      mobileDarkSrc="/hero/mobile-dark.webp"
      imageAlt="Abstract sculpture of interwoven metallic filaments and particles"
      loadFonts={false}
    />
  );
}
