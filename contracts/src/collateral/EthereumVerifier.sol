// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier} from "./LightClientVerifier.sol";

contract EthereumVerifier is LightClientVerifier {
    constructor(address lightClient_) LightClientVerifier(lightClient_) {}
}
