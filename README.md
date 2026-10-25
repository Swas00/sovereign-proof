# Sovereign Proof

User-controlled, zero-knowledge verifiable credentials with a key-compromise recovery policy.
Theme 4 / Problem 3: decentralized portable proofs.

## Run
```bash
npm install
npm run dev          # local chain :8545, API :8787, web http://localhost:5173 (all three, one command)
npm test             # 56 tests (crypto, ZK, verifier, incident, chain checks, diffs)
npm run chain:test   # 34 contract checks against the running local chain (resets it)
npm run e2e          # full incident storyline over HTTP with real proofs (needs `npm run dev` running)
```
`npm start` builds the web app and serves chain + API + UI (UI from :8787). If you only run the API, verifiers fail closed and the Trust page says why.
Circuit artifacts are committed. To rebuild them (about 20 min, needs `circom2` from npm): `npm run build:circuit`.

## The blockchain: an accountable audit ledger

A Solidity contract (`contracts/TrustAnchor.sol`) on a **local Hardhat chain** (EVM, chain id 31337). It stores only 32-byte hashes, counts and short public notes. Every record carries **who** wrote it, **when** (block time, set by the chain), and the **previous value**:

1. **Registry versions** (admin only): consecutive, each naming the previous hash.
2. **Issuance-log anchors** (the issuer's authorised service account only): Merkle roots plus the previous root. The key-compromise policy reads these: a credential survives a stolen key only if its log root was on the chain before the theft window opened, and a thief cannot backdate a block.
3. **Status-list versions** (the issuer's authorised account only): consecutive and hash-chained, so an old, validly signed revocation list cannot be replayed to un-revoke a credential.

**Unauthorised or invalid calls do not revert: they emit `Rejected(actor, action, target, reason, time)`**, so every attempt is recorded permanently with who made it and when.

The **Security & audit** tab shows the full change history (actor with role, time, action, previous -> new), and an **integrity check** that compares the served registry and status lists with the chain and explains every difference (which field changed, who published the genuine version, when, and the previous record). "Try to break it" lets you attempt an outsider write, edit the stored registry, or replay an old revocation list.

The verifier reads the chain itself and **fails closed** if it cannot. No credentials, names, dates or proofs are on-chain; privacy comes from the zero-knowledge proof.

**Signed writes and an anchored access log.** Privileged API actions (declare a compromise, revoke, re-issue, issue, restore) must carry an EIP-191 signature over the method, path, body hash, a one-time nonce and a timestamp. The server recovers the signer from the signature (it never trusts a claimed identity) and checks it is the registry admin or that issuer's own account. Unsigned, wrong-key, wrong-role, replayed, altered-body and stale requests are refused. Every attempt, accepted or denied, is an entry in a hash-chained access log, and the log's head is anchored on the chain after each entry, so editing, deleting, reordering or truncating history is detected, even by an attacker who recomputes every hash. Registry bodies and status lists are published with their content (the contract checks `sha256(content) == hash`), so the chain itself holds the exact previous value and "Restore" rebuilds from the chain.

Honest limits:
- **Attribution:** every write made through the application is attributed to a key. An edit that *bypasses* the application (raw file or database access) cannot carry a signature by definition: the system detects it, shows what changed against the chain, proves no authorised signed write explains it, and bounds it in time by the last intact on-chain anchor. Naming the *person* behind such a raw edit would still need host-level logging. Verifiers are unaffected, because they check the chain, not the server's copy.
- **Demo shortcuts:** actors sign with the local node's publicly known test keys (`packages/core/signing.ts`), and the server relays each transaction from the node's unlocked accounts after checking the actor's signature. In production every actor holds its own key and submits its own transactions. The demo-harness endpoints that stand for an adversary (steal, tamper, rollback, reset...) are deliberately unsigned, and are logged.
- "Previous -> new" is readable only because archived copies are kept off-chain; it is shown only when the archive re-hashes to exactly what the chain recorded.
- It is a local dev chain, not a public network, with one node (no real decentralisation). The demo steers the chain clock (`evm_setNextBlockTimestamp`) to replay a multi-week timeline; the node only allows going forward.
- The anchoring account must be a separate credential from the signing key. A thief holding both could still anchor inside the window, which the policy then quarantines; the window start must be set correctly.

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
