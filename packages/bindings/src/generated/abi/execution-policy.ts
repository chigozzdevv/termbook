export const executionPolicyAbi = [
  {
    "type": "function",
    "name": "pendingState",
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
        "name": "pendingId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ExecutionTypes.PendingState",
        "components": [
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "committed",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "filled",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refunded",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remaining",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxLiability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "observedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "positionSlots",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "refundRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum ExecutionTypes.Status"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "prepare",
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
        "name": "action",
        "type": "tuple",
        "internalType": "struct ExecutionTypes.Action",
        "components": [
          {
            "name": "capability",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "market",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "calls",
            "type": "tuple[]",
            "internalType": "struct ExecutionTypes.Call[]",
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
              }
            ]
          },
          {
            "name": "requiredInput",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "exposureLimit",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "beforeState",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "positionSlots",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "pendingSlots",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "exposure",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stateReader",
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
    "name": "verifyResult",
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
        "name": "action",
        "type": "tuple",
        "internalType": "struct ExecutionTypes.Action",
        "components": [
          {
            "name": "capability",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "market",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "calls",
            "type": "tuple[]",
            "internalType": "struct ExecutionTypes.Call[]",
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
              }
            ]
          },
          {
            "name": "requiredInput",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "exposureLimit",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "beforeState",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "results",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [
      {
        "name": "pendingIds",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  }
] as const;
