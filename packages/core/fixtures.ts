import { buildCrypto, CRED_TYPE, type Crypto } from "./crypto";
import { adminKeyFromSeed, publishNext, type SignedRegistry } from "./registry";
import { buildStatusList, type StatusList } from "./status";
import type { SignedCredential } from "./prover";

export const CODES = { CS_DEGREE: 555n, MEDICAL: 77n };
export const SIZE = 1024;
export const T0 = "2026-10-25T10:00:00.000Z";

/** Deterministic demo world: 3 trusted issuers, 1 extra university, 1 attacker, one holder. */
export async function buildWorld() {
  const c: Crypto = await buildCrypto();
  const admin = adminKeyFromSeed("registry-admin");
  const specs = [
    { issuerId: "gov-id", name: "National Identity Authority", credTypes: [1] },
    { issuerId: "uni-x", name: "Northfield University", credTypes: [2] },
    { issuerId: "uni-y", name: "Eastbrook University", credTypes: [2] },
    { issuerId: "med-board", name: "State Medical Board", credTypes: [3] },
  ];
  const keys = Object.fromEntries(specs.map((s) => [s.issuerId, c.keyFromSeed(s.issuerId + "-epoch1")]));
  const attacker = c.keyFromSeed("attacker");
  const registry: SignedRegistry = publishNext(null, (b) => {
    b.issuers = specs.map((s) => ({
      ...s,
      keys: [{ keyId: c.keyId(keys[s.issuerId].pub).toString(), pub: { Ax: keys[s.issuerId].pub.Ax.toString(), Ay: keys[s.issuerId].pub.Ay.toString() }, epoch: 1, status: "active" as const }],
    }));
  }, admin.priv, T0);

  const holderSecret = 987654321n;
  const issue = (issuerId: string, type: bigint, a1: bigint, a2: bigint, idx: bigint, salt: bigint, secret = holderSecret, key = keys[issuerId]): SignedCredential => {
    const fields = { type, holderId: c.holderId(secret), a1, a2, statusIndex: idx, salt };
    return { fields, sig: c.sign(key.prv, c.commitment(fields)), issuerPub: key.pub };
  };
  const creds = {
    id: issue("gov-id", CRED_TYPE.ID, 19950315n, 0n, 1n, 11n),
    degree: issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 2n, 22n),
    license: issue("med-board", CRED_TYPE.LICENSE, CODES.MEDICAL, 20300101n, 3n, 33n),
  };
  const lists = (revoked: Record<string, number[]> = {}) =>
    new Map<string, StatusList>(specs.map((s) => {
      const kid = c.keyId(keys[s.issuerId].pub).toString();
      return [kid, buildStatusList(c, keys[s.issuerId].prv, kid, 1, SIZE, revoked[s.issuerId] ?? [], T0)];
    }));
  return { c, admin, keys, attacker, registry, holderSecret, issue, creds, lists, specs };
}
