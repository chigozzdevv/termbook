// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library WormholeNetworks {
    function ethereumChain(uint256 chain) internal pure returns (uint256) {
        return chain == 10143 || chain == 11155111 ? 11155111 : 1;
    }

    function monadChain(uint256 chain) internal pure returns (uint256) {
        return chain == 10143 || chain == 11155111 ? 10143 : 143;
    }

    function monadWormholeChain(uint256 chain) internal pure returns (uint16) {
        return chain == 10143 || chain == 11155111 ? 10009 : 48;
    }

    function ethereumWormholeChain(uint256 chain) internal pure returns (uint16) {
        return chain == 10143 || chain == 11155111 ? 10002 : 2;
    }
}
