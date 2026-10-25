pragma circom 2.1.0;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";

// Poseidon Merkle inclusion: proves `leaf` is in the tree with public root `root`, revealing neither leaf nor position.
template MerkleRoot(D) {
    signal input leaf;
    signal input sib[D];
    signal input idx[D];
    signal output root;
    signal cur[D+1]; signal d[D]; signal l[D]; signal r[D];
    component h[D];
    cur[0] <== leaf;
    for (var i = 0; i < D; i++) {
        idx[i] * (idx[i] - 1) === 0;
        d[i] <== idx[i] * (sib[i] - cur[i]);
        l[i] <== cur[i] + d[i];
        r[i] <== sib[i] - d[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== l[i];
        h[i].inputs[1] <== r[i];
        cur[i+1] <== h[i].out;
    }
    root <== cur[D];
}

// Verifies one issuer-signed credential and exposes only: the issuer's key id and the status-list index.
// msg = Poseidon(type, holderId, a1, a2, statusIndex, salt)   (must match packages/core/crypto.ts)
template CredCheck(expectedType, D) {
    signal input Ax; signal input Ay;
    signal input R8x; signal input R8y; signal input S;
    signal input holderSecret;
    signal input a1; signal input a2;
    signal input statusIndex; signal input salt;
    signal input sib[D]; signal input idx[D];
    signal output keyId;
    signal output status;
    signal output root;

    component hid = Poseidon(1);
    hid.inputs[0] <== holderSecret;

    component msg = Poseidon(6);
    msg.inputs[0] <== expectedType;
    msg.inputs[1] <== hid.out;
    msg.inputs[2] <== a1;
    msg.inputs[3] <== a2;
    msg.inputs[4] <== statusIndex;
    msg.inputs[5] <== salt;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== Ax; sig.Ay <== Ay;
    sig.R8x <== R8x; sig.R8y <== R8y; sig.S <== S;
    sig.M <== msg.out;

    component kid = Poseidon(2);
    kid.inputs[0] <== Ax; kid.inputs[1] <== Ay;
    keyId <== kid.out;
    status <== statusIndex;

    // The commitment the issuer signed must also sit in the issuer's notarized issuance log.
    component mt = MerkleRoot(D);
    mt.leaf <== msg.out;
    for (var i = 0; i < D; i++) { mt.sib[i] <== sib[i]; mt.idx[i] <== idx[i]; }
    root <== mt.root;
}

template Compound() {
    var D = 10; // issuance-log depth: 1024 credentials per tree (a parameter; production would use 20+)
    // ---- public: the verifier's policy and challenge
    signal input ageCutoff;        // dob must be <= this (YYYYMMDD)
    signal input requiredDegree;   // degree code
    signal input requiredLicense;  // license type code
    signal input today;            // license expiry must be >= this
    signal input nonce;            // verifier challenge, binds the proof to this request

    // ---- private: holder secret and three signed credentials
    signal input holderSecret;
    signal input dob; signal input idSalt; signal input idStatus; signal input idAx; signal input idAy; signal input idR8x; signal input idR8y; signal input idS;
    signal input degCode; signal input degDate; signal input degSalt; signal input degStatus; signal input degAx; signal input degAy; signal input degR8x; signal input degR8y; signal input degS;
    signal input licType; signal input licExpiry; signal input licSalt; signal input licStatus; signal input licAx; signal input licAy; signal input licR8x; signal input licR8y; signal input licS;
    signal input idSib[D]; signal input idIdx[D];
    signal input degSib[D]; signal input degIdx[D];
    signal input licSib[D]; signal input licIdx[D];

    // ---- public outputs: which issuers signed, and which status-list slots to check
    signal output idKeyId; signal output degKeyId; signal output licKeyId;
    signal output idStatusOut; signal output degStatusOut; signal output licStatusOut;
    signal output idRoot; signal output degRoot; signal output licRoot;

    component id = CredCheck(1, D);
    id.Ax <== idAx; id.Ay <== idAy; id.R8x <== idR8x; id.R8y <== idR8y; id.S <== idS;
    id.holderSecret <== holderSecret; id.a1 <== dob; id.a2 <== 0; id.statusIndex <== idStatus; id.salt <== idSalt;
    for (var i = 0; i < D; i++) { id.sib[i] <== idSib[i]; id.idx[i] <== idIdx[i]; }
    idKeyId <== id.keyId; idStatusOut <== id.status; idRoot <== id.root;

    component deg = CredCheck(2, D);
    deg.Ax <== degAx; deg.Ay <== degAy; deg.R8x <== degR8x; deg.R8y <== degR8y; deg.S <== degS;
    deg.holderSecret <== holderSecret; deg.a1 <== degCode; deg.a2 <== degDate; deg.statusIndex <== degStatus; deg.salt <== degSalt;
    for (var i = 0; i < D; i++) { deg.sib[i] <== degSib[i]; deg.idx[i] <== degIdx[i]; }
    degKeyId <== deg.keyId; degStatusOut <== deg.status; degRoot <== deg.root;

    component lic = CredCheck(3, D);
    lic.Ax <== licAx; lic.Ay <== licAy; lic.R8x <== licR8x; lic.R8y <== licR8y; lic.S <== licS;
    lic.holderSecret <== holderSecret; lic.a1 <== licType; lic.a2 <== licExpiry; lic.statusIndex <== licStatus; lic.salt <== licSalt;
    for (var i = 0; i < D; i++) { lic.sib[i] <== licSib[i]; lic.idx[i] <== licIdx[i]; }
    licKeyId <== lic.keyId; licStatusOut <== lic.status; licRoot <== lic.root;

    // Predicate 1: age. dob <= cutoff
    component age = LessEqThan(32);
    age.in[0] <== dob; age.in[1] <== ageCutoff; age.out === 1;

    // Predicate 2: degree equals the required one
    degCode === requiredDegree;

    // Predicate 3: license type matches and has not expired
    licType === requiredLicense;
    component exp = GreaterEqThan(32);
    exp.in[0] <== licExpiry; exp.in[1] <== today; exp.out === 1;

    // Keep the nonce in the constraint system (it is a public input, so the proof only verifies for this nonce)
    signal nonceSq;
    nonceSq <== nonce * nonce;
}

component main {public [ageCutoff, requiredDegree, requiredLicense, today, nonce]} = Compound();
