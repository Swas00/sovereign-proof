import { Contract, ContractFactory, JsonRpcProvider, JsonRpcSigner, toBeHex, zeroPadValue } from "ethers";
import { readFileSync } from "node:fs";
import type { Anchor } from "../core/notary";
import type { SignedRegistry } from "../core/registry";

const artifact = JSON.parse(readFileSync(new URL("../../chain/TrustAnchor.json", import.meta.url), "utf8"));
export const RPC_URL = process.env.CHAIN_RPC ?? "http://127.0.0.1:8545";

// Local development chain (Hardhat node). Accounts are the node's own unlocked test accounts: no keys live in this repo.
//   0 registry admin · 1 gov-id · 2 uni-x (epoch 1 and 2) · 3 uni-y · 4 med-board · 9 spare
export const ACCOUNT = { admin: 0, "gov-id": 1, "uni-x": 2, "uni-y": 3, "med-board": 4 } as const;

const b32 = (decimalOrHex: string) => zeroPadValue(toBeHex(BigInt(decimalOrHex)), 32);
const dec = (bytes32: string) => BigInt(bytes32).toString();
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChainRegistryRecord { version: number; hash: string; prevHash: string; time: string; blockNumber?: number; txHash?: string }
export interface ChainSnapshot {
  ok: boolean; error?: string; network: string; rpc: string; contract: string; blockNumber: number; blockTime?: string;
  registry: ChainRegistryRecord[]; anchors: Anchor[];
}

/**
 * The public chain behind the trust layer. It stores only 32-byte hashes (registry versions and issuance-log roots).
 * Every write is serialised and stamped with the demo's simulated time via evm_setNextBlockTimestamp (a dev-chain feature);
 * the node itself refuses to go backwards, so recorded times can only move forward.
 */
export class Chain {
  online = false;
  /** Demo switch: behave as if the node were unreachable (verifiers must then fail closed). */
  forceOffline = false;
  error = "";
  contract: Contract | null = null;
  address = "";
  private signers: Record<number, JsonRpcSigner> = {};
  private queue: Promise<unknown> = Promise.resolve();
  readonly provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  private cache: { at: number; snap: ChainSnapshot } | null = null;

  /** Tries to reach the node; never throws. `online` says whether it worked. */
  static async connect(retries = 25, delayMs = 1000): Promise<Chain> {
    const c = new Chain();
    await c.ping(retries, delayMs);
    return c;
  }

  async ping(retries = 1, delayMs = 500): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try { await this.provider.send("eth_chainId", []); this.online = true; this.error = ""; return true; }
      catch (e: any) { this.online = false; this.error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 120); if (i < retries - 1) await sleep(delayMs); }
    }
    return false;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async lastBlockTime(): Promise<number> {
    return parseInt((await this.provider.send("eth_getBlockByNumber", ["latest", false])).timestamp, 16);
  }
  /** Sets the next block's timestamp to `iso` (or just after the previous block, never earlier) and runs the transaction. */
  private async at<T>(iso: string, tx: () => Promise<T>): Promise<T> {
    const want = Math.max(unix(iso), (await this.lastBlockTime()) + 1);
    await this.provider.send("evm_setNextBlockTimestamp", [want]);
    return tx();
  }
  private invalidate() { this.cache = null; }

  /** Clean slate: reset the dev chain to genesis and deploy a fresh contract. */
  async reset(): Promise<void> {
    return this.serial(async () => {
      if (!(await this.ping())) return;
      await this.provider.send("hardhat_reset", []);
      const accounts: string[] = await this.provider.send("eth_accounts", []);
      this.signers = Object.fromEntries(accounts.map((a, i) => [i, new JsonRpcSigner(this.provider, a)]));
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, this.signers[ACCOUNT.admin]);
      const deployed = await factory.deploy();
      await deployed.waitForDeployment();
      this.contract = new Contract(await deployed.getAddress(), artifact.abi, this.provider);
      this.address = await deployed.getAddress();
      this.invalidate();
    });
  }

  private as(account: number) { return this.contract!.connect(this.signers[account]) as Contract; }

  publishRegistry(reg: SignedRegistry, atIso: string) {
    return this.serial(() => this.at(atIso, async () => {
      const t = await this.as(ACCOUNT.admin).publishRegistry(reg.body.version, "0x" + reg.hash, "0x" + reg.body.prevHash);
      await t.wait(); this.invalidate();
    }));
  }
  authorise(keyId: string, account: number, atIso: string) {
    return this.serial(() => this.at(atIso, async () => { const t = await this.as(ACCOUNT.admin).authoriseAnchorer(b32(keyId), await this.signers[account].getAddress()); await t.wait(); this.invalidate(); }));
  }
  anchor(a: Pick<Anchor, "issuerKeyId" | "root" | "leafCount">, account: number, atIso: string) {
    return this.serial(() => this.at(atIso, async () => { const t = await this.as(account).anchorRoot(b32(a.issuerKeyId), b32(a.root), a.leafCount); await t.wait(); this.invalidate(); }));
  }

  /** Reads everything a verifier needs straight from the node (not from our API state). Cached for one second. */
  async snapshot(): Promise<ChainSnapshot> {
    const base: ChainSnapshot = { ok: false, network: "Hardhat local chain (31337)", rpc: RPC_URL, contract: this.address, blockNumber: 0, registry: [], anchors: [] };
    if (this.forceOffline) return { ...base, error: "chain unreachable (simulated outage)" };
    if (!this.contract) return { ...base, error: this.online ? "contract not deployed yet" : this.error || "chain unreachable" };
    if (this.cache && Date.now() - this.cache.at < 1000) return this.cache.snap;
    try {
      // Pin every read to the head block the node reports. ethers resolves the tag "latest" from a cached block number,
      // which would let a verifier read stale chain state.
      const head = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
      const tip = parseInt(head.number, 16), pin = { blockTag: tip };
      const n = Number(await this.contract.registryCount(pin));
      const regLogs = await this.contract.queryFilter(this.contract.filters.RegistryPublished(), 0, tip);
      const rootLogs = await this.contract.queryFilter(this.contract.filters.RootAnchored(), 0, tip);
      const loc = new Map(regLogs.map((l: any) => [Number(l.args.version), { blockNumber: l.blockNumber, txHash: l.transactionHash }]));
      const registry: ChainRegistryRecord[] = [];
      for (let i = 0; i < n; i++) {
        const r = await this.contract.registryAt(i, pin);
        registry.push({ version: Number(r.version), hash: String(r.hash).slice(2), prevHash: String(r.prevHash).slice(2), time: new Date(Number(r.time) * 1000).toISOString(), ...loc.get(Number(r.version)) });
      }
      const anchors: Anchor[] = (rootLogs as any[]).map((l) => ({
        issuerKeyId: dec(l.args.keyId), root: dec(l.args.root), leafCount: Number(l.args.leafCount),
        anchoredAt: new Date(Number(l.args.time) * 1000).toISOString(), sig: "", chain: { blockNumber: l.blockNumber, txHash: l.transactionHash },
      }));
      const snap: ChainSnapshot = { ...base, ok: true, blockNumber: tip, blockTime: new Date(parseInt(head.timestamp, 16) * 1000).toISOString(), registry, anchors };
      this.cache = { at: Date.now(), snap }; this.online = true; this.error = "";
      return snap;
    } catch (e: any) {
      this.online = false; this.error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 120);
      return { ...base, error: this.error };
    }
  }
}
