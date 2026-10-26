# Deploying Sovereign Proof

The app is stateful: a blockchain node plus an API that holds the demo state. It needs a host that runs a long-lived process, so ordinary serverless hosting (Vercel functions, Netlify functions) does not fit. One container runs everything:

- the development chain, listening on loopback inside the container only,
- the API on `$PORT`, which also serves the built web app,
- a locked-down `/rpc` gateway, the only way a browser wallet reaches the chain.

## Option A: Render (recommended)
1. The code is on GitHub (`Swas00/sovereign-proof`). In the Render dashboard choose **New, Blueprint**, connect GitHub, allow access to the repository, and pick it. Render reads `render.yaml` and builds the `Dockerfile`.
2. Apply. The first build takes several minutes (it installs dependencies and builds the web app).
3. Open `https://<your-service>.onrender.com/healthz`. It should return `{"ok":true,"chain":true}`. Then open the site.
4. Check it as a visitor would: Verify tab (create a request, generate the proof), then **Connect** in the header with MetaMask. MetaMask adds "Sovereign Proof demo chain" using the site's own `https://…/rpc` address.

Things to know about the free plan:
- **It sleeps after 15 minutes without traffic.** The next visit takes a minute or so while the chain and API restart, and the demo state resets to the start. Before judging, open the site and keep it warm, or point a free uptime monitor (for example UptimeRobot) at `/healthz` every 5 minutes.
- **Memory is 512 MB.** The whole stack used about 150 MB on a Mac, which suggests it fits, but a Mac compresses memory and Linux may differ. This was not measured on Render. If the service is killed for memory, move it to the Starter plan.
- **State is not saved.** A restart gives a fresh chain and a fresh demo. That is by design.

## Option B: run on the demo laptop and expose it with a tunnel
No cold starts, no hosting account, and the laptop must stay on and awake.
```bash
npm run dev            # or: npm start
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787
```
The tunnel gives an `https://` address. The wallet is handed `https://<that address>/rpc` automatically, which is what MetaMask requires. Not tested here (neither tool is installed on the machine where this was built).

## What a public deployment exposes, and what protects it
| Exposure | Protection |
|---|---|
| The chain node | Listens on loopback inside the container. Never published. Checked: from the network address, the node's port is refused. |
| Wallet access to the chain | `/rpc` allows reads and one transaction kind: a signed, zero-value `recordVerification` to the TrustAnchor contract. Every other method (`hardhat_*`, `evm_*`, `eth_sendTransaction`, `eth_accounts`, signing, debugging) and every other transaction (including ones signed with the public admin key) is refused. `npx tsx scripts/rpc-test.ts` checks 26 cases. |
| Authority actions (declare, issue, revoke, restore) | Need a signature from the right account, checked by the API. Not available through `/rpc`. |
| The demo controls (reset, simulated theft, tampering) | Take no signature by design, so a visitor can use them. Rate-limited per visitor (10 resets a minute, 120 API posts a minute). |
| The free faucet | Dev-chain test ETH only, once every 5 seconds per address, 60 grants an hour overall. |
| Real money | None. The chain is a development chain whose ETH has no value, the contract cannot hold money, and the app sends transactions only on this chain. The demo accounts' keys are public. |

**One shared demo.** There is a single demo state for everyone. If one person presses Reset demo or the attack buttons while a judge is mid-demo, the judge sees it. Give judges the link one at a time, or have them use the 3-minute script in `WALLET_GUIDE.md`.

## Settings
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | Port the API listens on (hosts set this) |
| `HOST` | 127.0.0.1 | `0.0.0.0` to accept outside connections. The Dockerfile and `render.yaml` set it. |
| `CHAIN_RPC` | http://127.0.0.1:8545 | Where the API finds the chain node |

## Checking a deployment
```bash
APP=https://<your-service>.onrender.com npx tsx scripts/rpc-test.ts        # 26 gateway security checks (resets the demo)
APP=https://<your-service>.onrender.com node scripts/wallet-e2e.mjs        # wallet flow, using the gateway address the app hands out
```
Run these once, not repeatedly: they reset the shared demo, and the per-visitor limits apply. They do not drive the real MetaMask popups.

## What was verified, and what was not
Verified: a clean checkout installs, builds and starts with `npm run serve` on a different port with `HOST=0.0.0.0`; `/healthz` answers; the chain node is not reachable from the network address; a visitor on a non-local address is handed the `/rpc` gateway URL; the gateway, wallet, checklist and button tests all pass against that run.
Not verified: the Docker image itself (no Docker on the build machine), the Render build, behaviour under Render's memory limit, and the tunnel option.
