#!/bin/bash
# One-command build of the compound circuit. Dev-only trusted setup (single local contribution).
set -e
cd "$(dirname "$0")/.."
B=circuits/build; mkdir -p $B
npx circom2 circuits/compound_proof.circom --r1cs --wasm -l node_modules -o $B
npx snarkjs r1cs info $B/compound_proof.r1cs
# 2^15 is enough for ~12-20k constraints; bump if r1cs info shows more
if [ ! -f $B/pot15.ptau ]; then
  npx snarkjs powersoftau new bn128 15 $B/p0.ptau >/dev/null
  npx snarkjs powersoftau contribute $B/p0.ptau $B/p1.ptau --name=dev -e="$(date +%s)-sovereign-proof" >/dev/null
  npx snarkjs powersoftau prepare phase2 $B/p1.ptau $B/pot15.ptau >/dev/null
fi
npx snarkjs groth16 setup $B/compound_proof.r1cs $B/pot15.ptau $B/c0.zkey >/dev/null
npx snarkjs zkey contribute $B/c0.zkey $B/compound.zkey --name=dev -e="$(date +%s)-phase2" >/dev/null
npx snarkjs zkey export verificationkey $B/compound.zkey $B/compound_vkey.json
echo "BUILD OK"
