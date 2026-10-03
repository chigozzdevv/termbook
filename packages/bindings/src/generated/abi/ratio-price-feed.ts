export const ratioPriceFeedAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "oracle_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "baseId_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "quoteId_",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "baseId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "baseRound",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoundData",
    "inputs": [
      {
        "name": "round",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestRound",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestRoundData",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracle",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IRatioPriceOracle"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteRound",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "update",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint80",
        "internalType": "uint80"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AnswerUpdated",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint80",
        "indexed": true,
        "internalType": "uint80"
      },
      {
        "name": "answer",
        "type": "int256",
        "indexed": false,
        "internalType": "int256"
      },
      {
        "name": "updatedAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "Invalid",
    "inputs": []
  }
] as const;
