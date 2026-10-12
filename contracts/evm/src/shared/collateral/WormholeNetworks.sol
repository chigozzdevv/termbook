// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library WormholeNetworks {
    error UnsupportedEvmChain();

    function isEvmSource(uint256 source, uint256 monad) internal pure returns (bool) {
        return (monad == 143 && (source == 1 || source == 8453))
            || (monad == 10143 && (source == 11155111 || source == 84532));
    }

    function evmWormholeChain(uint256 chain) internal pure returns (uint16) {
        if (chain == 1) return 2;
        if (chain == 11155111) return 10002;
        if (chain == 8453) return 30;
        if (chain == 84532) return 10004;
        revert UnsupportedEvmChain();
    }

    function ethereumChain(uint256 chain) internal pure returns (uint256) {
        return chain == 10143 || chain == 11155111 ? 11155111 : 1;
    }

    function monadChain(uint256 chain) internal pure returns (uint256) {
        return chain == 10143 || chain == 11155111 || chain == 84532 ? 10143 : 143;
    }

    function monadWormholeChain(uint256 chain) internal pure returns (uint16) {
        return chain == 10143 || chain == 11155111 || chain == 84532 ? 10009 : 48;
    }

    function ethereumWormholeChain(uint256 chain) internal pure returns (uint16) {
        return chain == 10143 || chain == 11155111 ? 10002 : 2;
    }
}
