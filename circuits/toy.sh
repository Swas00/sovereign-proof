#!/bin/bash
set -e
cd "$(dirname "$0")/.."
B=circuits/build
npx circom2 circuits/toy_age.circom --r1cs --wasm -l node_modules -o $B
npx snarkjs powersoftau new bn128 12 $B/p0.ptau -v >/dev/null
npx snarkjs powersoftau contribute $B/p0.ptau $B/p1.ptau --name=dev -e="dev entropy" >/dev/null
npx snarkjs powersoftau prepare phase2 $B/p1.ptau $B/pot.ptau >/dev/null
npx snarkjs groth16 setup $B/toy_age.r1cs $B/pot.ptau $B/toy0.zkey >/dev/null
npx snarkjs zkey contribute $B/toy0.zkey $B/toy.zkey --name=dev -e="more" >/dev/null
npx snarkjs zkey export verificationkey $B/toy.zkey $B/toy_vkey.json
echo '{"dob":"19950315","cutoff":"20050101"}' > $B/in.json
node $B/toy_age_js/generate_witness.js $B/toy_age_js/toy_age.wasm $B/in.json $B/w.wtns
npx snarkjs groth16 prove $B/toy.zkey $B/w.wtns $B/proof.json $B/public.json
npx snarkjs groth16 verify $B/toy_vkey.json $B/public.json $B/proof.json
echo "--- public signals (dob must NOT appear):"; cat $B/public.json
echo '{"dob":"20100315","cutoff":"20050101"}' > $B/bad.json
node $B/toy_age_js/generate_witness.js $B/toy_age_js/toy_age.wasm $B/bad.json $B/w2.wtns >/dev/null 2>&1 && echo "UNEXPECTED: underage witness succeeded" || echo "OK: underage witness rejected"
