# Sovereign Proof

User-controlled, zero-knowledge verifiable credentials with a key-compromise recovery policy.
Theme 4 / Problem 3: decentralized portable proofs.

## Run
```bash
npm install
npm run dev          # local chain :8545, API :8787, web http://localhost:5173 (all three, one command)
npm test             # 56 tests (crypto, ZK, verifier, incident, chain checks, diffs)
npm run chain:test   # 45 contract checks against the running local chain (resets it)
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

## Responsive and fast

`npm run audit:responsive` loads every page (in its busiest state, tables full) at 20 device profiles (a 280px folded phone, small and large phones in both orientations, tablets, laptops, 1440p, ultrawide) and checks for sideways scrolling, off-screen or clipped content, overlapping siblings, touch targets under 44px, inputs under 16px (iOS zooms the page on focus), tiny text, a squashed hero and tables that scroll inside their box. `SELFTEST=1` plants real defects to prove the probe can fail (an earlier version could not: on mobile, `innerWidth` grows with wide content, so the audit now compares against the true device width). Current result: **0 problems across 120 page loads**.

- Wide tables turn into labelled cards on small screens; controls are 44px on touch and 16px so iOS does not zoom; safe-area insets, `100svh`, no text inflation on rotate; large screens widen the layout.
- The hero has a minimum height, so a landscape phone scrolls instead of crushing the sculpture.
- **Proving runs in a Web Worker** (the page never freezes; falls back to the main thread if a browser cannot run workers). A request the credentials cannot satisfy gets a plain-language message instead of a circuit error.
- **Adaptive hero quality:** starts at lower density on phones and low-core devices, starts static when the browser reports a software renderer (no GPU), and drops to the static image if real frame times fall under ~25 fps while someone interacts.
- **Animated background on every app page** (not the landing hero): `components/ui/wave-mesh.tsx`, a canvas field of dots rolling like a sea. The pointer lifts a soft hill and a click sends a ring across it. Colours follow the light/dark theme and stay close to the page ground so text is never fighting it; it pauses when the tab is hidden, draws one still frame under reduced motion, and never intercepts the pointer. Cost, measured: about 15-30% of one main-thread core on desktop (about 6% on a phone, capped near 30 fps), frames stay at 17 ms even at a 4x CPU slowdown, no long tasks.
- Server sends compressed JS/CSS/WASM and caches content-hashed assets for a year; font CSS is latin-only; proving code loads only when needed.

Measured on a deliberately weak profile (4x CPU slowdown, slow-4G network), production build, phone viewport: first paint 5.5s -> 2.2s, largest content 7.5s -> 3.2s, layout shift 0.199 -> 0.002, transferred 1,175 KB -> 364 KB, and 0 ms of main-thread blocking while a proof is generated (was 334-407 ms). With WebGL off, a cursor sweep costs 66 ms of blocking and every frame stays at 17 ms.

Honest limits: these are headless-Chrome emulations on one machine, not real devices (Safari/iOS and Firefox are untested); the sculpture's real-GPU cost could only be measured with software rendering, which is why the governor exists; the first proof still downloads a 22 MB proving key (cached afterwards).

## Browser wallet (MetaMask)
A wallet is free to create and the key stays in the user's browser extension. The header's **Connect** control uses it for two things:
1. **Signing actions as yourself.** With "My wallet" selected, each authority button (declare, issue, revoke, restore) is signed by your wallet with `personal_sign` (EIP-191, same message the demo keys sign). The server recovers your address and checks it against the role table. A fresh wallet has no role, so the action is refused and the attempt is logged under your real address, in the access log whose head is anchored on the chain. Import a demo role key (panel, "Act as a demo role") and the same button succeeds, attributed to that role.
2. **Paying to anchor a result.** After a verification, "Anchor this result from your wallet" sends a transaction to `recordVerification` on `TrustAnchor`. The wallet pays the gas, the contract stamps the author and block time, and only a hash of the outcome goes on-chain (audit id, verdict, step outcomes, registry version). The chain page lists each receipt and whether it matches the verifier's own audit record. This is a statement by a wallet, not proof that the verdict is true.

Cost: on the local chain gas is paid in free test ETH ("Get free test ETH" calls a built-in faucet that exists only on chain id 31337, and the app shows the exact gas used and fee after each transaction). The app adds the network to MetaMask itself (`wallet_addEthereumChain`). With no wallet installed everything still works on the demo keys.
`node scripts/wallet-e2e.mjs` drives the site in headless Chrome with a stand-in for MetaMask (an EIP-1193 object backed by a real ethers wallet on the real chain). It checks our code paths: connect, add network, faucet, signing, refusal logged under the wallet's address, receipt transaction with gas, and fallback with no wallet. It does not drive MetaMask's own popups.

## What is real
- Groth16 proof (BN254, circom + snarkjs) of: three issuer EdDSA-Poseidon signatures, one holder, age over N, required degree, unexpired license, Poseidon Merkle inclusion in each issuer's issuance log. About 46k constraints, proved in the browser.
- Signed, hash-chained trust registry (Ed25519), signed status lists, and issuance-log roots plus registry hashes recorded on a local EVM chain.
- Verifier pipeline with replay protection, policy binding, per-credential trust and revocation decisions.

## What is simulated or limited
- The wallet integration is tested against a stand-in provider, not the real MetaMask extension. A public testnet (Sepolia) is not supported: the demo steers the chain clock with `evm_setNextBlockTimestamp`, which only a dev node offers. Anchoring receipts alone would work on any EVM chain, but that has not been tried.
- Anyone can record a receipt (that is the point of the open function), so a spammer can add noise. Receipts carry no authority, and the server marks which ones match its own audit record.
- Issuers and key custody run in one demo server, and the chain is a single local node. The registry and status lists are centralized, signed and versioned (hashes on the chain); the demo is not a decentralized network.
- Trusted setup is a single local contribution: dev only.
- The verifier sees issuer identity, each credential's revocation slot, and which notarized log root it belongs to.
- Genuine issuance during the theft window is quarantined until the university re-attests it.

## Layout
`circuits/` circom circuit and build script · `contracts/` + `chain/` Solidity contract, compiled artifact, compile script · `packages/core/` crypto, registry, status, issuance log, notary, incident policy, verifier · `packages/server/` Express API and demo state machine · `apps/web/` React UI · `tests/` vitest · `scripts/e2e.ts` HTTP storyline.
