// Only used to run the local chain (`npx hardhat node`). Contracts are compiled by chain/compile.mjs.
// initialDate puts the genesis block before the demo timeline starts, so block timestamps can follow it.
module.exports = {
  solidity: "0.8.20",
  networks: { hardhat: { chainId: 31337, initialDate: "2026-08-31T00:00:00Z", mining: { auto: true, interval: 0 } } },
  paths: { sources: "./contracts-unused" },
};
