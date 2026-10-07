// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Adapted from OpenZeppelin Math.mulDiv v5.0.2, credit Remco Bloemen and Uniswap Labs.
library FullMath {
    error Overflow();
    function mulDiv(uint256 x, uint256 y, uint256 denominator, bool roundUp) internal pure returns (uint256 result) {
        unchecked {
            uint256 low;
            uint256 high;
            assembly {
                let mm := mulmod(x, y, not(0))
                low := mul(x, y)
                high := sub(sub(mm, low), lt(mm, low))
            }
            if (denominator == 0 || denominator <= high) revert Overflow();
            uint256 remainder = mulmod(x, y, denominator);
            if (high == 0) result = low / denominator;
            else {
                assembly {
                    high := sub(high, gt(remainder, low))
                    low := sub(low, remainder)
                }
                uint256 twos = denominator & (0 - denominator);
                assembly {
                    denominator := div(denominator, twos)
                    low := div(low, twos)
                    twos := add(div(sub(0, twos), twos), 1)
                }
                low |= high * twos;
                uint256 inverse = (3 * denominator) ^ 2;
                inverse *= 2 - denominator * inverse;
                inverse *= 2 - denominator * inverse;
                inverse *= 2 - denominator * inverse;
                inverse *= 2 - denominator * inverse;
                inverse *= 2 - denominator * inverse;
                inverse *= 2 - denominator * inverse;
                result = low * inverse;
            }
            if (roundUp && remainder != 0) {
                if (result == type(uint256).max) revert Overflow();
                ++result;
            }
        }
    }
}
