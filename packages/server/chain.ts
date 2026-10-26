import { Contract, ContractFactory, JsonRpcProvider, JsonRpcSigner, formatEther, isAddress, parseEther, toBeHex, toUtf8Bytes, toUtf8String, zeroPadValue } from "ethers";
import { readFileSync } from "node:fs";
import type { Anchor } from "../core/notary";
import { canonical, type SignedRegistry } from "../core/registry";

const artifact = JSON.parse(readFileSync(new URL("../../chain/TrustAnchor.json", import.meta.url), "utf8"));
export const RPC_URL = process.env.CHAIN_RPC ?? "http://127.0.0.1:8545";
/** The only chain this server will talk to: the local development chain, whose ETH has no value. Anything else is refused. */
export const DEV_CHAIN_ID = 31337;

// Local development chain (Hardhat node). Accounts are the node's own unlocked test accounts: no keys live in this repo.
export const ACCOUNT = { admin: 0, "gov-id": 1, "uni-x": 2, "uni-y": 3, "med-board": 4, auditor: 8, stranger: 9 } as const;
const LABELS: Record<number, string> = {
  0: "Registry admin", 1: "National Identity Authority · service account", 2: "Northfield University · service account",
  3: "Eastbrook University · service account", 4: "State Medical Board · service account", 8: "Audit-log anchoring service", 9: "Unknown account (not authorised)",
};

const b32 = (decimalOrHex: string) => zeroPadValue(toBeHex(BigInt(decimalOrHex)), 32);
const dec = (bytes32: string) => BigInt(bytes32).toString();
const hex = (bytes32: string) => bytes32.slice(2);
const iso = (unix: bigint | number) => new Date(Number(unix) * 1000).toISOString();
const unix = (s: string) => Math.floor(Date.parse(s) / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = "0x" + "00".repeat(32);

export interface ChainRegistryRecord { version: number; hash: string; prevHash: string; time: string; publisher: string; publisherLabel: string; blockNumber?: number; txHash?: string; content: string; sig: string }
export interface ChainStatusRecord { keyId: string; version: number; hash: string; prevHash: string; time: string; publisher: string; publisherLabel: string; blockNumber: number; txHash: string; content: string }
export interface AuditHead { seq: number; head: string; time: string; blockNumber: number; txHash: string }
export interface AuditEntry {
  id: string; kind: "ok" | "rejected"; blockNumber: number; txHash: string; time: string; actor: string; actorLabel: string;
  action: string; target?: string; previous?: string; next?: string; note?: string;
}
export interface Receipt { receipt: string; verifier: string; verifierLabel: string; registryVersion: number; accepted: boolean; time: string; blockNumber: number; txHash: string }
export interface ChainSnapshot {
  ok: boolean; error?: string; network: string; rpc: string; contract: string; blockNumber: number; blockTime?: string;
  registry: ChainRegistryRecord[]; anchors: Anchor[]; receipts: Receipt[]; status: Record<string, ChainStatusRecord[]>; audit: AuditEntry[]; auditHeads: AuditHead[];
}
export class ChainRejected extends Error {}

/**
 * The public audit ledger. Every write is serialised and stamped with the demo's simulated time via
 * evm_setNextBlockTimestamp (a dev-chain feature; the node refuses to go backwards). The contract records who wrote what,
 * when, and the previous value, and records unauthorised attempts instead of silently refusing them.
 */
export class Chain {
  online = false;
  forceOffline = false; // demo switch: behave as if the node were unreachable (verifiers must then fail closed)
  error = "";
  contract: Contract | null = null;
  address = "";
  private signers: Record<number, JsonRpcSigner> = {};
  private addrLabel: Record<string, string> = {};
  private queue: Promise<unknown> = Promise.resolve();
  readonly provider: JsonRpcProvider;
  constructor(rpcUrl: string = RPC_URL) { this.provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true }); }
  private cache: { at: number; snap: ChainSnapshot } | null = null;

  static async connect(retries = 25, delayMs = 1000, rpcUrl?: string): Promise<Chain> {
    const c = new Chain(rpcUrl);
    await c.ping(retries, delayMs);
    return c;
  }

  async ping(retries = 1, delayMs = 500): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const id = Number(await this.provider.send("eth_chainId", []));
        if (id !== DEV_CHAIN_ID) { this.online = false; this.error = `refusing to use chain ${id}: this demo only runs on the ${DEV_CHAIN_ID} development chain`; return false; } // a real network must never be written to
        this.online = true; this.error = ""; return true;
      }
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
  /** Sets the next block's timestamp to `atIso` (or just after the previous block, never earlier) and runs `tx`. */
  private async at<T>(atIso: string | null, tx: () => Promise<T>): Promise<T> {
    await this.provider.send("evm_setNextBlockTimestamp", [Math.max(atIso ? unix(atIso) : 0, (await this.lastBlockTime()) + 1)]);
    return tx();
  }
  private invalidate() { this.cache = null; }
  private as(account: number) { return this.contract!.connect(this.signers[account]) as Contract; }

  /** Sends a write, mines it, and returns the Rejected record if the contract refused it (it never reverts). */
  private async write(account: number, atIso: string | null, call: (c: Contract) => Promise<any>, strict: boolean) {
    return this.serial(() => this.at(atIso, async () => {
      const tx = await call(this.as(account));
      const receipt = await tx.wait();
      this.invalidate();
      const rej = (receipt.logs as any[]).map((l) => { try { return this.contract!.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "Rejected");
      if (rej && strict) throw new ChainRejected(`${rej.args.action}: ${rej.args.reason}`);
      return rej ? { rejected: true as const, action: String(rej.args.action), reason: String(rej.args.reason), txHash: receipt.hash as string } : { rejected: false as const, txHash: receipt.hash as string };
    }));
  }

  /** Clean slate: reset the dev chain to genesis and deploy a fresh contract. */
  async reset(): Promise<void> {
    return this.serial(async () => {
      if (!(await this.ping())) return;
      await this.provider.send("hardhat_reset", []);
      const accounts: string[] = await this.provider.send("eth_accounts", []);
      this.signers = Object.fromEntries(accounts.map((a, i) => [i, new JsonRpcSigner(this.provider, a)]));
      this.addrLabel = Object.fromEntries(accounts.map((a, i) => [a.toLowerCase(), LABELS[i] ?? "Unknown account (not authorised)"]));
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, this.signers[ACCOUNT.admin]);
      const deployed = await factory.deploy();
      await deployed.waitForDeployment();
      this.address = await deployed.getAddress();
      this.contract = new Contract(this.address, artifact.abi, this.provider);
      this.invalidate();
    });
  }
  addressOf(account: number): string { const s = this.signers[account]; return s ? (s as any).address : ""; }
  labelOf(address: string) { return this.addrLabel[address.toLowerCase()] ?? "Unknown account (not authorised)"; }

  // --- authorised writes (throw if the contract refuses) ---
  publishRegistry(reg: SignedRegistry, atIso: string, note: string) {
    // content = the canonical body (the contract checks it hashes to reg.hash); extra = the admin's detached signature
    return this.write(ACCOUNT.admin, atIso, (c) => c.publishRegistry(reg.body.version, "0x" + reg.hash, "0x" + reg.body.prevHash, note, toUtf8Bytes(canonical(reg.body)), toUtf8Bytes(reg.sig)), true);
  }
  authorise(keyId: string, account: number, atIso: string) {
    return this.write(ACCOUNT.admin, atIso, async (c) => c.authoriseAnchorer(b32(keyId), await this.signers[account].getAddress()), true);
  }
  anchor(a: Pick<Anchor, "issuerKeyId" | "root" | "leafCount">, account: number, atIso: string) {
    return this.write(account, atIso, (c) => c.anchorRoot(b32(a.issuerKeyId), b32(a.root), a.leafCount), true);
  }
  publishStatus(keyId: string, version: number, hash: string, note: string, account: number, atIso: string, content: string) {
    return this.write(account, atIso, (c) => c.publishStatusList(b32(keyId), version, "0x" + hash, note, toUtf8Bytes(content)), true);
  }
  setAuditor(account: number, atIso: string) {
    return this.write(ACCOUNT.admin, atIso, async (c) => c.setAuditor(await this.signers[account].getAddress()), true);
  }
  /** Anchors the access log's head. Stamped just after the previous block so it never disturbs the simulated timeline. */
  anchorAuditHead(seq: number, headHex: string) {
    return this.write(ACCOUNT.auditor, null, (c) => c.anchorAuditHead(seq, "0x" + headHex), true);
  }

  /** What a browser wallet needs to join this chain. */
  /** `publicRpc`: the HTTPS gateway URL to give a wallet when the page is not served from this computer. */
  async info(publicRpc?: string) {
    const id = Number(await this.provider.send("eth_chainId", []));
    const local = id === 31337;
    return { chainId: id, chainIdHex: "0x" + id.toString(16), name: local ? (publicRpc ? "Sovereign Proof TEST chain" : "Sovereign Proof TEST chain (local)") : `Chain ${id}`, // MetaMask shows this name: it must say TEST rpc: publicRpc ?? RPC_URL, symbol: "ETH", local, contract: this.address,
      faucet: local, roles: Object.entries(ACCOUNT).filter(([r]) => r !== "stranger").map(([role, i]) => ({ role, address: this.addressOf(i), label: LABELS[i] })) };
  }
  /** Raw read: ethers' getBalance resolves "latest" from a cached block number and can return a stale balance. */
  async balanceOf(address: string): Promise<bigint> { return BigInt(await this.provider.send("eth_getBalance", [address, "latest"])); }
  private lastFund = new Map<string, number>();
  private fundTimes: number[] = []; // global cap on faucet grants, so a public deployment cannot be drained of its dev-chain test ETH
  /** Local-chain faucet: sends test ETH from an unused dev account, like a testnet faucet would. Refuses on any other chain. */
  async fund(address: string): Promise<{ txHash: string; amount: string; balance: string }> {
    if (!isAddress(address)) throw new Error("not a valid address");
    if (!(await this.info()).local) throw new Error("the built-in faucet only exists on the local dev chain");
    const hourAgo = Date.now() - 3_600_000;
    this.fundTimes = this.fundTimes.filter((t) => t > hourAgo);
    if (this.fundTimes.length >= 60) throw new Error("the faucet is busy: it sends at most 60 grants an hour. Try again later");
        const key = address.toLowerCase(), last = this.lastFund.get(key) ?? 0;
    if (Date.now() - last < 5000) throw new Error("slow down: one request every few seconds per address");
    this.lastFund.set(key, Date.now()); this.fundTimes.push(Date.now());
    const AMOUNT = parseEther("1");
    const bal = await this.balanceOf(address);
    if (bal >= parseEther("5")) throw new Error("this wallet already has plenty of test ETH");
    const r = await this.serial(() => this.at(null, async () => {
      const tx = await this.signers[7].sendTransaction({ to: address, value: AMOUNT });
      const receipt = await tx.wait(); this.invalidate(); return receipt!.hash;
    }));
    return { txHash: r, amount: "1", balance: formatEther(await this.balanceOf(address)) };
  }

  // --- demo: an outsider tries to change things. The contract records each attempt permanently. ---
  async attemptUnauthorised(atIso: string, targets: { keyId: string; registryVersion: number; registryPrevHash: string }) {
    const junk = "0x" + "de".repeat(32);
    const out = [];
    out.push(await this.write(ACCOUNT.stranger, atIso, (c) => c.publishRegistry(targets.registryVersion, junk, "0x" + targets.registryPrevHash, "attempt to rewrite the trust registry", "0x", "0x"), false));
    out.push(await this.write(ACCOUNT.stranger, atIso, (c) => c.anchorRoot(b32(targets.keyId), junk, 1), false));
    out.push(await this.write(ACCOUNT.stranger, atIso, (c) => c.publishStatusList(b32(targets.keyId), 99, junk, "attempt to publish a forged status list", "0x"), false));
    return out;
  }

  /** Reads everything a verifier needs straight from the node (not from our API state). Cached for one second. */
  async snapshot(): Promise<ChainSnapshot> {
    const base: ChainSnapshot = { ok: false, network: "Hardhat local chain (31337)", rpc: RPC_URL, contract: this.address, blockNumber: 0, registry: [], anchors: [], receipts: [], status: {}, audit: [], auditHeads: [] };
    if (this.forceOffline) return { ...base, error: "chain unreachable (simulated outage)" };
    if (!this.contract) return { ...base, error: this.online ? "contract not deployed yet" : this.error || "chain unreachable" };
    try {
      // Pin every read to the head block the node reports (ethers resolves "latest" from a cached block number).
      const head = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
      const tip = parseInt(head.number, 16);
      // Reuse the last read only while the chain has not moved: a wallet can write straight to the chain, bypassing this server.
      if (this.cache && this.cache.snap.blockNumber === tip) return this.cache.snap;
      const raw = await this.provider.getLogs({ address: this.address, fromBlock: 0, toBlock: tip });
      const events = raw.map((l) => ({ l, p: this.contract!.interface.parseLog({ topics: [...l.topics], data: l.data }) })).filter((e) => e.p)
        .sort((a, b) => a.l.blockNumber - b.l.blockNumber || a.l.index - b.l.index);
      const receipts: Receipt[] = [];
      const registry: ChainRegistryRecord[] = [], anchors: Anchor[] = [], audit: AuditEntry[] = [], auditHeads: AuditHead[] = [];
      const status: Record<string, ChainStatusRecord[]> = {};
      const keyHex = (b: string) => dec(b);
      for (const { l, p } of events) {
        const a = p!.args as any, id = `${l.blockNumber}-${l.index}`;
        const common = { id, blockNumber: l.blockNumber, txHash: l.transactionHash };
        switch (p!.name) {
          case "RegistryPublished": {
            const rec: ChainRegistryRecord = { version: Number(a.version), hash: hex(a.hash), prevHash: hex(a.prevHash), time: iso(a.time), publisher: a.publisher, publisherLabel: this.labelOf(a.publisher), blockNumber: l.blockNumber, txHash: l.transactionHash, content: toUtf8String(a.content), sig: toUtf8String(a.extra) };
            registry.push(rec);
            audit.push({ ...common, kind: "ok", time: rec.time, actor: a.publisher, actorLabel: rec.publisherLabel, action: `Registry v${rec.version} published`, previous: a.prevHash === ZERO ? undefined : hex(a.prevHash), next: rec.hash, note: a.note });
            break; }
          case "StatusPublished": {
            const rec: ChainStatusRecord = { keyId: keyHex(a.keyId), version: Number(a.version), hash: hex(a.hash), prevHash: hex(a.prevHash), time: iso(a.time), publisher: a.publisher, publisherLabel: this.labelOf(a.publisher), blockNumber: l.blockNumber, txHash: l.transactionHash, content: toUtf8String(a.content) };
            (status[rec.keyId] ??= []).push(rec);
            audit.push({ ...common, kind: "ok", time: rec.time, actor: a.publisher, actorLabel: rec.publisherLabel, action: `Status list v${rec.version} published`, target: rec.keyId, previous: a.prevHash === ZERO ? undefined : hex(a.prevHash), next: rec.hash, note: a.note });
            break; }
          case "RootAnchored": {
            const sender = a.sender as string;
            anchors.push({ issuerKeyId: keyHex(a.keyId), root: dec(a.root), leafCount: Number(a.leafCount), anchoredAt: iso(a.time), sig: "",
              chain: { blockNumber: l.blockNumber, txHash: l.transactionHash, sender, senderLabel: this.labelOf(sender), prevRoot: a.prevRoot === ZERO ? undefined : dec(a.prevRoot) } });
            audit.push({ ...common, kind: "ok", time: iso(a.time), actor: sender, actorLabel: this.labelOf(sender), action: "Issuance-log root anchored", target: keyHex(a.keyId), previous: a.prevRoot === ZERO ? undefined : dec(a.prevRoot), next: dec(a.root), note: `${Number(a.leafCount)} log entr${Number(a.leafCount) === 1 ? "y" : "ies"}` });
            break; }
          case "AnchorerAuthorised":
            audit.push({ ...common, kind: "ok", time: iso(a.time), actor: a.by, actorLabel: this.labelOf(a.by), action: "Anchoring account authorised", target: keyHex(a.keyId), previous: a.previousAnchorer === "0x0000000000000000000000000000000000000000" ? undefined : this.labelOf(a.previousAnchorer), next: this.labelOf(a.anchorer) });
            break;
          case "AuditHeadAnchored":
            auditHeads.push({ seq: Number(a.seq), head: hex(a.head), time: iso(a.time), blockNumber: l.blockNumber, txHash: l.transactionHash });
            break;
          case "AuditorSet":
            audit.push({ ...common, kind: "ok", time: iso(a.time), actor: a.by, actorLabel: this.labelOf(a.by), action: "Audit-log anchoring account set", previous: a.previousAuditor === "0x0000000000000000000000000000000000000000" ? undefined : this.labelOf(a.previousAuditor), next: this.labelOf(a.auditor) });
            break;
          case "VerificationRecorded": {
            const verifierLabel = this.labelOf(a.verifier) === "Unknown account (not authorised)" ? "Self-custodied wallet" : this.labelOf(a.verifier);
            receipts.push({ receipt: hex(a.receipt), verifier: a.verifier, verifierLabel, registryVersion: Number(a.registryVersion), accepted: !!a.accepted, time: iso(a.time), blockNumber: l.blockNumber, txHash: l.transactionHash });
            audit.push({ ...common, kind: "ok", time: iso(a.time), actor: a.verifier, actorLabel: verifierLabel, action: "Verification receipt anchored", next: hex(a.receipt), note: `${a.accepted ? "accepted" : "not accepted"} under registry v${Number(a.registryVersion)}` });
            break; }
          case "Rejected":
            audit.push({ ...common, kind: "rejected", time: iso(a.time), actor: a.actor, actorLabel: this.labelOf(a.actor), action: String(a.action), target: dec(a.target), note: String(a.reason) });
            break;
        }
      }
      const snap: ChainSnapshot = { ...base, ok: true, blockNumber: tip, blockTime: iso(parseInt(head.timestamp, 16)), registry, anchors, receipts, status, audit, auditHeads };
      this.cache = { at: Date.now(), snap }; this.online = true; this.error = "";
      return snap;
    } catch (e: any) {
      this.online = false; this.error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 120);
      return { ...base, error: this.error };
    }
  }
}
