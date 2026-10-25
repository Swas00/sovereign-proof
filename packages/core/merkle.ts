import type { Crypto } from "./crypto";

export interface MerklePath { siblings: bigint[]; indices: number[] }

/**
 * Append-only issuance log: a Poseidon Merkle tree over credential commitments.
 * Leaves are salted commitments, so publishing them reveals nothing about holders or attributes.
 * Must match MerkleRoot() in circuits/compound_proof.circom (left = idx 0, hash = Poseidon(left, right)).
 */
export class IssuanceLog {
  private leaves: bigint[] = [];
  private zeros: bigint[];
  constructor(private c: Crypto, public readonly depth: number) {
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) this.zeros.push(c.hash([this.zeros[i], this.zeros[i]]));
  }
  get size() { return this.leaves.length; }
  append(leaf: bigint): number { this.leaves.push(leaf); return this.leaves.length - 1; }

  private levels(count: number): bigint[][] {
    const out: bigint[][] = [this.leaves.slice(0, count)];
    for (let d = 0; d < this.depth; d++) {
      const cur = out[d], next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) next.push(this.c.hash([cur[i], i + 1 < cur.length ? cur[i + 1] : this.zeros[d]]));
      out.push(next);
    }
    return out;
  }
  /** Root of the tree as it was when it held its first `count` leaves (what a notary anchored). */
  rootAt(count = this.leaves.length): bigint {
    const l = this.levels(count)[this.depth];
    return l.length ? l[0] : this.zeros[this.depth];
  }
  pathAt(index: number, count = this.leaves.length): MerklePath {
    if (index >= count) throw new RangeError("leaf was not in the log at that anchor");
    const lv = this.levels(count), siblings: bigint[] = [], indices: number[] = [];
    let i = index;
    for (let d = 0; d < this.depth; d++) {
      const sib = i ^ 1;
      siblings.push(sib < lv[d].length ? lv[d][sib] : this.zeros[d]);
      indices.push(i & 1);
      i >>= 1;
    }
    return { siblings, indices };
  }
}

export function verifyPath(c: Crypto, leaf: bigint, p: MerklePath, root: bigint): boolean {
  let cur = leaf;
  for (let d = 0; d < p.siblings.length; d++) cur = p.indices[d] ? c.hash([p.siblings[d], cur]) : c.hash([cur, p.siblings[d]]);
  return cur === root;
}

/** Recompute the root a (leaf, path) pair implies; used to show which notarized root a stored credential belongs to. */
export function rootFromPath(c: Crypto, leaf: bigint, p: MerklePath): bigint {
  let cur = leaf;
  for (let d = 0; d < p.siblings.length; d++) cur = p.indices[d] ? c.hash([p.siblings[d], cur]) : c.hash([cur, p.siblings[d]]);
  return cur;
}
