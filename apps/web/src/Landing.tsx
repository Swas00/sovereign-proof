import SculptureHero from "@/components/ui/liquid-sculpture-hero";
import InkOrbitFeatures from "@/components/ui/ink-orbit-features";

const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export default function Landing() {
  return (
    <>
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
      <div className="landing-features">
        <InkOrbitFeatures
          theme="auto"
          brand="Sovereign Proof"
          tag="How it works"
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
            description: "Trust registry, notary anchors, issuer logs and status lists. A verifier needs nothing else, and none of it names a holder.",
            tools: ["Registry", "Notary", "Issuer log", "Status list"],
          }}
          insights={{
            title: "Incident-aware trust",
            description: "When a university's key is stolen, credentials anchored before the theft window stay valid, and anything issued inside it is quarantined.",
            values: [8, 12, 15, 19, 22, 26, 29, 31, 33, 38, 41, 45],
            forecastFrom: 8,
          }}
        />
      </div>
    </>
  );
}
