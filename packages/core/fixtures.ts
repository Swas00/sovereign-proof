import { buildCrypto, CRED_TYPE, type Crypto } from "./crypto";
import { adminKeyFromSeed, publishNext, type SignedRegistry } from "./registry";
import { buildStatusList, type StatusList } from "./status";
import type { SignedCredential } from "./prover";
import { IssuanceLog } from "./merkle";
import { makeAnchor, type Anchor } from "./notary";

export const CODES = { CS_DEGREE: 555n, MEDICAL: 77n };
export const SIZE = 1024;
export const PEOPLE = {
  alice: { name: "Alice Verma", address: "12 Harbor Lane, Northfield" },
  mallory: { name: "Mallory Cross", address: "7 Dockside Road, Eastbrook" },
};
export const DEPTH = 10; // must equal D in circuits/compound_proof.circom
// Demo timeline
export const T_REGISTRY = "2026-09-01T08:00:00.000Z";
export const T_LEGACY = "2026-10-01T09:00:00.000Z"; // legitimate issuance + notarization
export const WINDOW_START = "2026-10-23T10:00:00.000Z"; // earliest the key could have been stolen
export const T_FRAUD = "2026-10-24T09:00:00.000Z"; // attacker's anchor, inside the 48h window
export const WINDOW_END = "2026-10-25T10:00:00.000Z";
export const T_DECLARED = "2026-10-25T10:05:00.000Z";

export interface Issued { cred: Omit<SignedCredential, "merkle">; log: IssuanceLog; index: number }

/** Deterministic demo world: 4 trusted issuers, an attacker, a notary, one holder, legitimate legacy credentials. */
export async function buildWorld() {
  const c: Crypto = await buildCrypto();
  const admin = adminKeyFromSeed("registry-admin");
  const notary = adminKeyFromSeed("independent-notary");
  const specs = [
    { issuerId: "gov-id", name: "National Identity Authority", credTypes: [1] },
    { issuerId: "uni-x", name: "Northfield University", credTypes: [2] },
    { issuerId: "uni-y", name: "Eastbrook University", credTypes: [2] },
    { issuerId: "med-board", name: "State Medical Board", credTypes: [3] },
  ];
  const keys = Object.fromEntries(specs.map((s) => [s.issuerId, c.keyFromSeed(s.issuerId + "-epoch1")]));
  const keyIdOf = (k: { pub: any }) => c.keyId(k.pub).toString();
  const attacker = c.keyFromSeed("attacker");
  const registry: SignedRegistry = publishNext(null, (b) => {
    b.issuers = specs.map((s) => ({
      ...s,
      keys: [{ keyId: keyIdOf(keys[s.issuerId]), pub: { Ax: keys[s.issuerId].pub.Ax.toString(), Ay: keys[s.issuerId].pub.Ay.toString() }, epoch: 1, status: "active" as const }],
    }));
  }, admin.priv, T_REGISTRY);

  const logs: Record<string, IssuanceLog> = Object.fromEntries(specs.map((s) => [s.issuerId, new IssuanceLog(c, DEPTH)]));
  const anchors: Anchor[] = [];
  const anchorLog = (key: { pub: any }, log: IssuanceLog, at: string) => {
    const a = makeAnchor(keyIdOf(key), log.rootAt(), log.size, notary.priv, at);
    anchors.push(a);
    return a;
  };

  const holderSecret = 987654321n;
  /** Sign a credential with `key` and append its commitment to `log` (default: the issuer's own log). */
  const issue = (issuerId: string, type: bigint, a1: bigint, a2: bigint, idx: bigint, salt: bigint,
    o: { secret?: bigint; key?: { prv: Uint8Array; pub: any }; log?: IssuanceLog } = {}): Issued => {
    const key = o.key ?? keys[issuerId], log = o.log ?? logs[issuerId];
    const fields = { type, holderId: c.holderId(o.secret ?? holderSecret), a1, a2, statusIndex: idx, salt };
    const m = c.commitment(fields);
    return { cred: { fields, sig: c.sign(key.prv, m), issuerPub: key.pub }, log, index: log.append(m) };
  };
  /** Holder side: attach the Merkle path against a specific notarized anchor. */
  const present = (i: Issued, anchor: Anchor): SignedCredential => ({ ...i.cred, merkle: i.log.pathAt(i.index, anchor.leafCount) });

  // Legitimate legacy issuance, notarized well before the incident.
  const legacy = {
    id: issue("gov-id", CRED_TYPE.ID, 19950315n, c.identityBinding(PEOPLE.alice.name, PEOPLE.alice.address), 1n, 11n),
    degree: issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, 2n, 22n),
    license: issue("med-board", CRED_TYPE.LICENSE, CODES.MEDICAL, 20300101n, 3n, 33n),
  };
  const aId = anchorLog(keys["gov-id"], logs["gov-id"], T_LEGACY);
  const aDeg = anchorLog(keys["uni-x"], logs["uni-x"], T_LEGACY);
  const aLic = anchorLog(keys["med-board"], logs["med-board"], T_LEGACY);
  const creds = { id: present(legacy.id, aId), degree: present(legacy.degree, aDeg), license: present(legacy.license, aLic) };

  /** The attacker holds uni-x's real signing key and runs their own log; the notary timestamps it during the window. */
  const fraudDegree = (secret = holderSecret, idx = 9n): SignedCredential => {
    const attackerLog = new IssuanceLog(c, DEPTH);
    const i = issue("uni-x", CRED_TYPE.DEGREE, CODES.CS_DEGREE, 20180601n, idx, 99n, { key: keys["uni-x"], log: attackerLog, secret });
    return present(i, anchorLog(keys["uni-x"], attackerLog, T_FRAUD));
  };

  const lists = (revoked: Record<string, number[]> = {}, extraKeys: { issuerId: string; key: any }[] = []) =>
    new Map<string, StatusList>([...specs.map((s) => ({ issuerId: s.issuerId, key: keys[s.issuerId] })), ...extraKeys].map(({ issuerId, key }) => {
      const kid = keyIdOf(key);
      return [kid, buildStatusList(c, key.prv, kid, 1, SIZE, revoked[issuerId] ?? [], T_LEGACY)];
    }));
  return { c, admin, notary, keys, keyIdOf, attacker, registry, anchors, anchorLog, logs, holderSecret, issue, present, creds, legacy, fraudDegree, lists, specs };
}
