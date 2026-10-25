// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TrustAnchor: the public, append-only record behind Sovereign Proof.
 *
 * It stores only 32-byte hashes and counts. Never credentials, names, dates or proofs.
 *
 *  1. Registry versions. The registry admin publishes each signed trust-registry version's hash. Versions must be
 *     consecutive and each must name the previous hash, so history can be extended but never rewritten or rolled back.
 *  2. Issuance-log anchors. An issuer's authorised service account posts the Merkle root of its credential log.
 *     The timestamp is block.timestamp: set by the chain, so neither the issuer nor anyone holding a stolen
 *     signing key can backdate it. That is the evidence the key-compromise recovery policy relies on.
 */
contract TrustAnchor {
    struct RegistryRecord { uint32 version; bytes32 hash; bytes32 prevHash; uint64 time; }
    struct Anchor { bytes32 root; uint32 leafCount; uint64 time; }

    address public immutable admin;
    RegistryRecord[] private registries;
    mapping(bytes32 => address) public anchorerOf; // issuer key id => the service account allowed to anchor for it
    mapping(bytes32 => Anchor[]) private anchorsOf;
    bytes32[] private anchoredKeys; // every key id that has at least one anchor, for enumeration
    mapping(bytes32 => bool) private seenKey;

    event RegistryPublished(uint32 indexed version, bytes32 hash, bytes32 prevHash, uint64 time);
    event AnchorerAuthorised(bytes32 indexed keyId, address indexed anchorer);
    event RootAnchored(bytes32 indexed keyId, bytes32 root, uint32 leafCount, uint64 time);

    error NotAdmin();
    error NotAnchorer();
    error BadVersion(uint32 expected, uint32 got);
    error BadPrevHash();

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    constructor() { admin = msg.sender; }

    function publishRegistry(uint32 version, bytes32 hash, bytes32 prevHash) external onlyAdmin {
        uint256 n = registries.length;
        uint32 expected = uint32(n + 1);
        if (version != expected) revert BadVersion(expected, version);
        if (prevHash != (n == 0 ? bytes32(0) : registries[n - 1].hash)) revert BadPrevHash();
        registries.push(RegistryRecord(version, hash, prevHash, uint64(block.timestamp)));
        emit RegistryPublished(version, hash, prevHash, uint64(block.timestamp));
    }

    function authoriseAnchorer(bytes32 keyId, address anchorer) external onlyAdmin {
        anchorerOf[keyId] = anchorer;
        emit AnchorerAuthorised(keyId, anchorer);
    }

    function anchorRoot(bytes32 keyId, bytes32 root, uint32 leafCount) external {
        if (msg.sender != anchorerOf[keyId] || msg.sender == address(0)) revert NotAnchorer();
        anchorsOf[keyId].push(Anchor(root, leafCount, uint64(block.timestamp)));
        if (!seenKey[keyId]) { seenKey[keyId] = true; anchoredKeys.push(keyId); }
        emit RootAnchored(keyId, root, leafCount, uint64(block.timestamp));
    }

    function registryCount() external view returns (uint256) { return registries.length; }
    function registryAt(uint256 i) external view returns (RegistryRecord memory) { return registries[i]; }
    function anchorCount(bytes32 keyId) external view returns (uint256) { return anchorsOf[keyId].length; }
    function anchorAt(bytes32 keyId, uint256 i) external view returns (Anchor memory) { return anchorsOf[keyId][i]; }
    function keyCount() external view returns (uint256) { return anchoredKeys.length; }
    function keyAt(uint256 i) external view returns (bytes32) { return anchoredKeys[i]; }
}
