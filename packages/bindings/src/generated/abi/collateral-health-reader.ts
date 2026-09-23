export const collateralHealthReaderAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "core_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "oracleRegistry_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "core",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract TermbookCore"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "disableMarket",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "settlementAsset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "governance",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketId",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "settlementAsset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "markets",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "priceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "settlementCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "retainedSourceBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "collateralDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "settlementDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "recoveryCosts",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracleRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "readHealth",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "revision",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "oracleRegistry_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "reading",
        "type": "tuple",
        "internalType": "struct HealthReading",
        "components": [
          {
            "name": "debt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cash",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sourceValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "appValue",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "retainedSource",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "retainedApp",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "recoveryCosts",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "observedAt",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setMarket",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "settlementAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "retainedSourceBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "recoveryCosts",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "MarketDisabled",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketSet",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sourceChain",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidCredit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMarket",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
