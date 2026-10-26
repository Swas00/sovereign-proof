import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { Chain } from "../packages/server/chain";

// A stand-in JSON-RPC node that reports whatever chain id it is told to.
const servers: Server[] = [];
const node = (chainIdHex: string) => new Promise<string>((resolve) => {
  const s = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => { // ethers may batch requests
      const reply = (r: { id: unknown }) => ({ jsonrpc: "2.0", id: r.id, result: chainIdHex });
      const parsed = JSON.parse(body); res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(reply) : reply(parsed)));
    });
  }).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  servers.push(s);
});
afterAll(() => { servers.forEach((s) => s.close()); });

describe("the server only talks to the development chain", () => {
  it("accepts chain 31337", async () => {
    const c = await Chain.connect(1, 0, await node("0x7a69"));
    expect(c.online).toBe(true);
  });
  for (const [name, id] of [["Ethereum mainnet", "0x1"], ["Sepolia testnet", "0xaa36a7"], ["Polygon", "0x89"], ["Base", "0x2105"]] as const) {
    it(`refuses ${name}`, async () => {
      const c = await Chain.connect(1, 0, await node(id));
      expect(c.online).toBe(false);
      expect(c.error).toMatch(/refusing to use chain/);
      expect(c.contract).toBeNull(); // nothing is ever deployed or written
    });
  }
});
