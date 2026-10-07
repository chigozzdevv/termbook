export const appGatewayAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "rules_",
        "type": "tuple[]",
        "internalType": "struct AppGateway.Rule[]",
        "components": [
          {
            "name": "capability",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "selector",
            "type": "bytes4",
            "internalType": "bytes4"
          },
          {
            "name": "paramsLength",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "accountWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creditWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "spendToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxSpend",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxNativeValue",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "NO_WORD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "buildCall",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "params",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "call_",
        "type": "tuple",
        "internalType": "struct ExecutionTypes.Call",
        "components": [
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "data",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "nativeValue",
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
    "name": "buildNativeCall",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "params",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "nativeValue",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ExecutionTypes.Call",
        "components": [
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "data",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "nativeValue",
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
    "name": "manifestHash",
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
    "name": "rule",
    "inputs": [
      {
        "name": "capability",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AppGateway.Rule",
        "components": [
          {
            "name": "capability",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "selector",
            "type": "bytes4",
            "internalType": "bytes4"
          },
          {
            "name": "paramsLength",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "accountWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creditWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "spendToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxSpend",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxNativeValue",
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
    "name": "spendTokenCodeHash",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
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
    "name": "targetCodeHash",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
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
    "type": "error",
    "name": "Bounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Invalid",
    "inputs": []
  }
] as const;
