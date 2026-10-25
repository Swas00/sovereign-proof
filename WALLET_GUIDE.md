# Using a wallet (MetaMask) with Sovereign Proof

## One-time setup (5 minutes)
1. Install MetaMask from https://metamask.io/download/ (free). Use a separate browser profile for the demo if you have a real wallet.
2. Create a wallet: choose a password and save the recovery phrase. Creating a wallet costs nothing and uses no server.
3. Start the project: `npm run dev`, then open http://localhost:5173/#app/verify.
4. Do not send real money to any account used here. The demo role keys are public test keys that anyone can derive.

## The demo accounts (public test keys)
Import one into MetaMask (Account menu, Import account, paste the private key) to hold that role. The wallet panel's "Copy key" button copies the same value. These keys are public and worthless on any real network: never send real money to them.

| Role | What it can do in the demo | Address | Private key |
|---|---|---|---|
| admin | Declare a compromise, restore data from the chain | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| uni-x (Northfield University) | Re-attest degrees, issue as the university | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| uni-y (Eastbrook University) | Issue as the second university | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| gov-id (National Identity Authority) | Issue national IDs | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| med-board (State Medical Board) | Revoke and issue medical licenses | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |

The audit-log anchoring account has no key in the browser; the server uses it.

Which button needs which role (with "My wallet" selected):
- Trust: **2 · Declare key compromise** needs admin. **3 · University re-issues** needs uni-x. **Revoke Alice's license** needs med-board. **1 · Thief issues** and the take-down toggles need nobody.
- Issue: **Sign & issue** needs the role of the issuer chosen in the form (uni-x by default).
- Audit: **Restore from the chain** needs admin. The attack buttons and the verification flow need nobody.
- A button that is refused tells you which role it needs. To run the whole storyline with one click each and no wallet prompts, choose **Demo keys** in the wallet panel.

`node scripts/wallet-buttons.mjs` clicks every button listed here, in a real browser, and checks each one's effect (37 checks).

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

## No real money: what guarantees it
You can say each of these and point at where it is enforced.

| Guarantee | Enforced by | Checked by |
|---|---|---|
| The contract cannot hold or move money | `TrustAnchor` has no payable function, no `receive` and no `fallback`. The chain refuses any ETH sent to it. | `npm run chain:test` sends ETH both ways and confirms the contract balance stays zero |
| The app never sends value | Every transaction carries `value: 0x0` | `wallet-e2e` inspects the transaction handed to the wallet |
| The app only transacts on the local test chain | Before any transaction it checks the server's chain id and the wallet's chain id are both 31337, and that a contract exists at the target | `wallet-e2e` runs a wallet that stays on Ethereum mainnet: no transaction is offered and nothing reaches the chain |
| The fee is bounded | Gas is capped at 200,000 units | `wallet-e2e` |
| The ETH here has no value | Chain 31337 runs on your computer. The faucet exists only on that chain and refuses anywhere else. | `chain:test`, plus the "Test network. No real money." marker in the wallet panel |
| Signing cannot spend | Authority actions use `personal_sign` on a plain text message, which cannot move funds | the signed text is shown in MetaMask |
| Other devices cannot reach the demo controls | The API listens on this computer only. Phone testing needs `HOST=0.0.0.0`, which prints that it is reachable. | start-up message |

Habits that keep it that way:
- Use a separate browser profile (or a throwaway wallet) for the demo. Do not import a wallet that holds real funds.
- The demo role keys are public. On a real network, anything sent to those addresses is taken within seconds by bots. The panel turns red and says so if a role account is ever used off the test chain.
- Do not start the server with `HOST=0.0.0.0` on a shared network during judging.
- If MetaMask ever shows a network other than "Sovereign Proof local chain" when you press Anchor, the app will refuse and say nothing was sent.

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
