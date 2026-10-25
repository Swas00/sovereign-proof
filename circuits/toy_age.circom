pragma circom 2.1.0;
include "circomlib/circuits/comparators.circom";

// Toy gate: prove dob <= cutoff (age >= threshold) without revealing dob.
template ToyAge() {
    signal input dob;      // private, YYYYMMDD
    signal input cutoff;   // public
    signal output ok;
    component le = LessEqThan(32);
    le.in[0] <== dob;
    le.in[1] <== cutoff;
    le.out === 1;
    ok <== le.out;
}
component main {public [cutoff]} = ToyAge();
