// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TrustAnchor: the public, append-only audit ledger behind Sovereign Proof.
 *
 * It stores only 32-byte hashes, counts and short public notes. Never credentials, names, dates or proofs.
 * Every record carries WHO wrote it (msg.sender), WHEN (block.timestamp, set by the chain) and the PREVIOUS value,
 * so any change can be traced and compared with what came before.
 *
 *  1. Registry versions (admin only): consecutive, each naming the previous hash.
 *  2. Issuance-log anchors (the issuer's authorised service account only): Merkle roots, with the previous root.
 *  3. Status-list versions (the issuer's authorised service account only): consecutive, each naming the previous hash.
 *     Anchoring these means an old, validly signed revocation list cannot be replayed to un-revoke a credential.
 *  4. Access-log heads (the auditor account only): the head hash of the server's hash-chained access log after each
 *     entry, so the log cannot be rewritten without contradicting the chain.
 *
 * Registry bodies and status lists are published WITH their content, and the contract checks sha256(content) == hash.
 * The chain therefore holds the exact previous value of everything it hashes, independent of any server archive.
 *
 * Unauthorised or invalid calls do NOT revert. They emit Rejected(actor, action, target, reason, time) and change
 * nothing else, so every attempt is recorded permanently with who made it and when.
 */
contract TrustAnchor {
    struct RegistryRecord { uint32 version; bytes32 hash; bytes32 prevHash; uint64 time; address publisher; }
    struct StatusRecord { uint32 version; bytes32 hash; bytes32 prevHash; uint64 time; address publisher; }
    struct Anchor { bytes32 root; uint32 leafCount; uint64 time; address sender; }

    address public immutable admin;
    RegistryRecord[] private registries;
    mapping(bytes32 => address) public anchorerOf; // issuer key id => the service account allowed to write for it
    mapping(bytes32 => Anchor[]) private anchorsOf;
    mapping(bytes32 => StatusRecord[]) private statusOf;
    address public auditor; // the account that anchors access-log heads
    bytes32[] private auditHeads;
    bytes32[] private anchoredKeys;
    mapping(bytes32 => bool) private seenKey;

    event RegistryPublished(uint32 indexed version, bytes32 hash, bytes32 prevHash, uint64 time, address indexed publisher, string note, bytes content, bytes extra);
    event StatusPublished(bytes32 indexed keyId, uint32 indexed version, bytes32 hash, bytes32 prevHash, uint64 time, address indexed publisher, string note, bytes content);
    event AuditHeadAnchored(uint64 indexed seq, bytes32 head, uint64 time, address indexed by);
    event AuditorSet(address indexed auditor, address previousAuditor, uint64 time, address indexed by);
    event RootAnchored(bytes32 indexed keyId, bytes32 root, uint32 leafCount, bytes32 prevRoot, uint64 time, address indexed sender);
    event AnchorerAuthorised(bytes32 indexed keyId, address indexed anchorer, address previousAnchorer, uint64 time, address indexed by);
    event Rejected(address indexed actor, string action, bytes32 indexed target, string reason, uint64 time);


    constructor() { admin = msg.sender; }

    function _reject(string memory action, bytes32 target, string memory reason) private returns (bool) {
        emit Rejected(msg.sender, action, target, reason, uint64(block.timestamp));
        return false;
    }

    // `content` is the canonical registry body; the contract checks it hashes to `hash`. `extra` is the admin's detached signature.
    function publishRegistry(uint32 version, bytes32 hash, bytes32 prevHash, string calldata note, bytes calldata content, bytes calldata extra) external returns (bool) {
        if (msg.sender != admin) return _reject("publishRegistry", hash, "caller is not the registry admin");
        uint256 n = registries.length;
        if (version != uint32(n + 1)) return _reject("publishRegistry", hash, "not the next consecutive version");
        if (prevHash != (n == 0 ? bytes32(0) : registries[n - 1].hash)) return _reject("publishRegistry", hash, "previous hash does not match the latest record");
        if (sha256(content) != hash) return _reject("publishRegistry", hash, "content does not hash to the stated hash");
        registries.push(RegistryRecord(version, hash, prevHash, uint64(block.timestamp), msg.sender));
        emit RegistryPublished(version, hash, prevHash, uint64(block.timestamp), msg.sender, note, content, extra);
        return true;
    }

    function authoriseAnchorer(bytes32 keyId, address anchorer) external returns (bool) {
        if (msg.sender != admin) return _reject("authoriseAnchorer", keyId, "caller is not the registry admin");
        address previous = anchorerOf[keyId];
        anchorerOf[keyId] = anchorer;
        emit AnchorerAuthorised(keyId, anchorer, previous, uint64(block.timestamp), msg.sender);
        return true;
    }

    function anchorRoot(bytes32 keyId, bytes32 root, uint32 leafCount) external returns (bool) {
        if (msg.sender != anchorerOf[keyId] || msg.sender == address(0)) return _reject("anchorRoot", keyId, "caller is not this issuer's authorised account");
        Anchor[] storage list = anchorsOf[keyId];
        bytes32 prevRoot = list.length == 0 ? bytes32(0) : list[list.length - 1].root;
        list.push(Anchor(root, leafCount, uint64(block.timestamp), msg.sender));
        if (!seenKey[keyId]) { seenKey[keyId] = true; anchoredKeys.push(keyId); }
        emit RootAnchored(keyId, root, leafCount, prevRoot, uint64(block.timestamp), msg.sender);
        return true;
    }

    function publishStatusList(bytes32 keyId, uint32 version, bytes32 hash, string calldata note, bytes calldata content) external returns (bool) {
        if (msg.sender != anchorerOf[keyId] || msg.sender == address(0)) return _reject("publishStatusList", keyId, "caller is not this issuer's authorised account");
        StatusRecord[] storage list = statusOf[keyId];
        if (version != uint32(list.length + 1)) return _reject("publishStatusList", keyId, "not the next consecutive version");
        if (sha256(content) != hash) return _reject("publishStatusList", keyId, "content does not hash to the stated hash");
        bytes32 prev = list.length == 0 ? bytes32(0) : list[list.length - 1].hash;
        list.push(StatusRecord(version, hash, prev, uint64(block.timestamp), msg.sender));
        emit StatusPublished(keyId, version, hash, prev, uint64(block.timestamp), msg.sender, note, content);
        return true;
    }

    function setAuditor(address a) external returns (bool) {
        if (msg.sender != admin) return _reject("setAuditor", bytes32(0), "caller is not the registry admin");
        address previous = auditor;
        auditor = a;
        emit AuditorSet(a, previous, uint64(block.timestamp), msg.sender);
        return true;
    }

    function anchorAuditHead(uint64 seq, bytes32 head) external returns (bool) {
        if (msg.sender != auditor || msg.sender == address(0)) return _reject("anchorAuditHead", head, "caller is not the auditor account");
        if (seq != uint64(auditHeads.length + 1)) return _reject("anchorAuditHead", head, "not the next consecutive log sequence number");
        auditHeads.push(head);
        emit AuditHeadAnchored(seq, head, uint64(block.timestamp), msg.sender);
        return true;
    }
    function auditHeadCount() external view returns (uint256) { return auditHeads.length; }

    function registryCount() external view returns (uint256) { return registries.length; }
    function registryAt(uint256 i) external view returns (RegistryRecord memory) { return registries[i]; }
    function anchorCount(bytes32 keyId) external view returns (uint256) { return anchorsOf[keyId].length; }
    function anchorAt(bytes32 keyId, uint256 i) external view returns (Anchor memory) { return anchorsOf[keyId][i]; }
    function statusCount(bytes32 keyId) external view returns (uint256) { return statusOf[keyId].length; }
    function statusAt(bytes32 keyId, uint256 i) external view returns (StatusRecord memory) { return statusOf[keyId][i]; }
    function keyCount() external view returns (uint256) { return anchoredKeys.length; }
    function keyAt(uint256 i) external view returns (bytes32) { return anchoredKeys[i]; }
}
