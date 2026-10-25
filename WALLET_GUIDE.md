# Using a wallet (MetaMask) with Sovereign Proof

## One-time setup (5 minutes)
1. Install MetaMask from https://metamask.io/download/ (free). Use a separate browser profile for the demo if you have a real wallet.
2. Create a wallet: choose a password and save the recovery phrase. Creating a wallet costs nothing and uses no server.
3. Start the project: `npm run dev`, then open http://localhost:5173/#app/verify.
4. Do not send real money to any account used here. The demo role keys are public test keys that anyone can derive.

## The 3-minute demo (say it while you click)
| Step | You do | What the judge sees | What to say |
|---|---|---|---|
| 1 | Press **Connect** (top right), then **Connect MetaMask** and approve. | The network is added automatically. Your address, balance 0, and "No role". | "A wallet is free. My key stays in the extension; the server only ever sees signatures." |
| 2 | **Get free test ETH**. | Balance 1 ETH. | "Gas is the fee for writing to a chain. On this local chain it is free test ETH." |
| 3 | Go to **Audit**. The checklist is at the top. Press **Restore from the chain** and approve the signature. | A refusal. The checklist ticks "action without authority", and your address appears in the access log as denied. | "Anyone can try. The server recovers my address from the signature, sees it has no role, refuses, and records me by address and time." |
| 4 | Open the wallet panel, **Act as a demo role**, copy the **admin** key. In MetaMask: Account menu, Import account, paste. Switch to that account. | The banner now says "holds the role Registry admin". | "Now the same wallet identity has authority." |
| 5 | Press **Restore from the chain** again. | Accepted, attributed to Registry admin. Checklist ticks. | "Authority is a key, not a username. Every write is attributable." |
| 6 | **Verify** tab: create a request, generate the proof, press **Anchor this result from your wallet**, confirm the fee in MetaMask. | Block, transaction, gas used and fee. The receipt then appears on the chain panel as "matches". | "I paid gas to put a hash of this outcome on the chain under my address. No credential data goes on-chain." |
| 7 | **Trust** tab, press **Outsider tries to change data** (optional). | Refused attempts recorded on the chain with the actor. | "Even failed attempts leave a permanent record." |

## If something goes wrong
- **"nonce too high" or a stuck transaction.** MetaMask remembers your transaction count, and the demo chain resets. In MetaMask: Settings, Advanced, **Clear activity tab data**. Do this after every **Reset demo** or node restart.
- **No popup appears.** Click the MetaMask icon in the toolbar; a request may be waiting. The app says so if one is already open.
- **Wrong network.** Use **Switch** in the wallet panel.
- **Not enough ETH.** **Get free test ETH** in the panel (the faucet gives 1 ETH when you have under 5).
- **The checklist did not tick.** It reads the real access log and chain, so refresh the page and check that the signer in the banner is the account you expect.
- **No MetaMask at all.** Everything still works on the built-in demo keys; switch the panel to **Demo keys**.

## What it proves, and what it does not
- Proves: who signed each action (the address is recovered from the signature), that a role-less address is refused and recorded, and that a wallet can pay to anchor a hash of a verification outcome.
- Does not prove: that the verdict in a receipt is true (the server cross-checks it against its own audit record), that a person is who they say in real life, or decentralization (one local node, one server).
- Not tested with the real extension in automation. The automated test uses a stand-in provider backed by a real key on the real chain (`node scripts/wallet-e2e.mjs`). Do the walkthrough above once with real MetaMask before the evaluation.

## Questions a judge may ask
**Why a wallet at all?** It gives each actor a key they control, so an action is attributable to an address that nobody else can sign for. Without it, "who did this" rests on a username the server could forge.

**Who pays?** The sender of a transaction pays gas. Here it is free test ETH on a local chain. On a public testnet it is faucet ETH, and on mainnet real money. That is also a spam deterrent.

**Why can anyone record a receipt?** A verifier should not need permission to attest. A receipt carries no authority: it says "this wallet recorded this hash at this time", and the server marks whether it matches a verification it actually ran.

**Does the wallet link my credentials to my address?** No. The credential proof does not involve the wallet. The address appears only on actions you choose to sign and on receipts you choose to anchor. Linking a holder's wallet to every presentation would let verifiers correlate that person across checks, so it is deliberately not done.

**Could the server fake who signed?** No. It recovers the signer from the signature and the signed text binds the method, path, body hash, a one-time nonce and a timestamp. It cannot sign for an address it does not hold the key for. (In this demo the server does hold the public demo keys; a real deployment would not.)

**Why not a public testnet?** The demo replays a 48-hour incident by steering the chain clock, which only a development node allows. Anchoring receipts alone would work on any EVM chain, but we have not tried that.
