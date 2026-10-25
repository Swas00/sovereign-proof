# Sovereign Proof

User-controlled, zero-knowledge verifiable credentials with a key-compromise recovery policy.
Theme 4 / Problem 3: decentralized portable proofs.

## Run
```bash
npm install
npm run dev          # API on :8787, web on http://localhost:5173
npm test             # 30 tests (crypto, ZK, verifier, incident)
npm run e2e          # full incident storyline over HTTP with real proofs (server must be running)
```
`npm start` builds the web app and serves everything from :8787.
Circuit artifacts are committed. To rebuild them (about 20 min, needs `circom2` from npm): `npm run build:circuit`.

## What is real
- Groth16 proof (BN254, circom + snarkjs) of: three issuer EdDSA-Poseidon signatures, one holder, age over N, required degree, unexpired license, Poseidon Merkle inclusion in each issuer's issuance log. About 46k constraints, proved in the browser.
- Signed, hash-chained trust registry (Ed25519), signed status lists, notary-anchored issuance logs.
- Verifier pipeline with replay protection, policy binding, per-credential trust and revocation decisions.

## What is simulated or limited
- Issuers, notary and key custody run in one demo server. The registry and status lists are centralized, signed and versioned; this is not a decentralized network.
- Trusted setup is a single local contribution: dev only.
- The verifier sees issuer identity, each credential's revocation slot, and which notarized log root it belongs to.
- Genuine issuance during the theft window is quarantined until the university re-attests it.

## Layout
`circuits/` circom circuit and build script · `packages/core/` crypto, registry, status, issuance log, notary, incident policy, verifier · `packages/server/` Express API and demo state machine · `apps/web/` React UI · `tests/` vitest · `scripts/e2e.ts` HTTP storyline.
