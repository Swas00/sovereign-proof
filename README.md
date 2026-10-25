# Sovereign Proof

User-controlled, zero-knowledge verifiable credentials with a key-compromise recovery policy.
Theme 4 / Problem 3: decentralized portable proofs.

## Run
```bash
npm install
npm run dev          # local chain :8545, API :8787, web http://localhost:5173 (all three, one command)
npm test             # 36 tests (crypto, ZK, verifier, incident, chain-registry check)
npm run chain:test   # 17 contract checks against the running local chain (resets it)
npm run e2e          # full incident storyline over HTTP with real proofs (needs `npm run dev` running)
```
`npm start` builds the web app and serves chain + API + UI (UI from :8787). If you only run the API, verifiers fail closed and the Trust page says why.
Circuit artifacts are committed. To rebuild them (about 20 min, needs `circom2` from npm): `npm run build:circuit`.

## The blockchain

A Solidity contract (`contracts/TrustAnchor.sol`) on a **local Hardhat chain** (EVM, chain id 31337). It stores only 32-byte hashes:

1. **Issuance-log anchors.** An issuer's authorised service account posts the Merkle root of its credential log. The timestamp is the block time, so nobody (including a thief holding a university's signing key) can backdate it. The key-compromise recovery policy reads exactly this: a credential is preserved only if its log root was on the chain before the theft window opened.
2. **Registry version hashes.** Each registry version must be consecutive and name the previous hash. A verifier compares the registry it is shown with the chain and rejects a stale, rolled-back or forked one, even one that carries a valid signature.

The verifier reads the chain itself and **fails closed** if it cannot. Privacy is unaffected: no credentials, names, dates or proofs are on-chain; privacy comes from the zero-knowledge proof.

Honest limits: it is a local dev chain, not a public network; the demo steers the chain clock (`evm_setNextBlockTimestamp`) to replay a multi-week timeline, which the node only allows going forward; one node means no real decentralisation; the anchoring account must be a separate credential from the signing key (a thief with both could still anchor inside the window, which the policy then quarantines).

## What is real
- Groth16 proof (BN254, circom + snarkjs) of: three issuer EdDSA-Poseidon signatures, one holder, age over N, required degree, unexpired license, Poseidon Merkle inclusion in each issuer's issuance log. About 46k constraints, proved in the browser.
- Signed, hash-chained trust registry (Ed25519), signed status lists, and issuance-log roots plus registry hashes recorded on a local EVM chain.
- Verifier pipeline with replay protection, policy binding, per-credential trust and revocation decisions.

## What is simulated or limited
- Issuers and key custody run in one demo server, and the chain is a single local node. The registry and status lists are centralized, signed and versioned (hashes on the chain); the demo is not a decentralized network.
- Trusted setup is a single local contribution: dev only.
- The verifier sees issuer identity, each credential's revocation slot, and which notarized log root it belongs to.
- Genuine issuance during the theft window is quarantined until the university re-attests it.

## Layout
`circuits/` circom circuit and build script · `contracts/` + `chain/` Solidity contract, compiled artifact, compile script · `packages/core/` crypto, registry, status, issuance log, notary, incident policy, verifier · `packages/server/` Express API and demo state machine · `apps/web/` React UI · `tests/` vitest · `scripts/e2e.ts` HTTP storyline.
