// Compiles contracts/TrustAnchor.sol with the pure-JS solc package (no compiler download) into chain/TrustAnchor.json.
import solc from "solc";
import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync(new URL("../contracts/TrustAnchor.sol", import.meta.url), "utf8");
const input = { language: "Solidity", sources: { "TrustAnchor.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.log(e.severity.toUpperCase() + ":", e.formattedMessage.trim());
if (errors.length) process.exit(1);
const c = out.contracts["TrustAnchor.sol"].TrustAnchor;
writeFileSync(new URL("./TrustAnchor.json", import.meta.url), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 1));
console.log(`compiled TrustAnchor: ${c.abi.length} ABI entries, ${(c.evm.bytecode.object.length / 2)} bytes of bytecode`);
