// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library AuthLib {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Termbook");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    uint256 internal constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    function checkDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert("expired");
    }

    function checkRecipient(address recipient) internal pure {
        if (recipient == address(0)) revert("bad-recipient");
    }

    function verify(bytes32 digest, bytes memory sig, address expected) internal view returns (bool) {
        if (expected.code.length > 0) {
            (bool ok, bytes memory result) = expected.staticcall(
                abi.encodeWithSignature("isValidSignature(bytes32,bytes)", digest, sig)
            );
            return ok && result.length >= 4 && bytes4(result) == 0x1626ba7e;
        }
        if (sig.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;
        if (uint256(s) > SECP256K1N_HALF) return false;
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == expected) return true;
        bytes32 personalDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(personalDigest, v, r, s) == expected;
    }

    function typedDigest(bytes32 separator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", separator, structHash));
    }

    function domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function quoteDigest(
        bytes32 domain,
        bytes32 intentId,
        address borrower,
        address house,
        uint256 limit,
        uint256 nonce,
        uint256 expiry,
        bytes32 termsHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(domain, intentId, borrower, house, limit, nonce, expiry, termsHash));
    }
}
