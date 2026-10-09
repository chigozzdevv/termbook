export const flowExecutorAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "core_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "breached",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bundles",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "policy",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reader",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "policyCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "readerCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "policyHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "maxPositions",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "maxPending",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "maxAge",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "complete",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
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
              },
              {
                "name": "nativeValue",
                "type": "uint256",
                "internalType": "uint256"
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
        "name": "reservation",
        "type": "tuple",
        "internalType": "struct ExecutionManager.Reservation",
        "components": [
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
          },
          {
            "name": "positionsBefore",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "results",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configure",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "policy",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxPositions",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "maxPending",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "maxAge",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "permissions",
        "type": "tuple[]",
        "internalType": "struct ExecutionManager.Permission[]",
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
          }
        ]
      },
      {
        "name": "perAction",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxExposure",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregateExposure",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "generation",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "consumeSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      },
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
        "name": "spend",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "exposure",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "generation",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
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
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initialize",
    "inputs": [
      {
        "name": "core_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pendingAt",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "pendingCount",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "policyHash",
    "inputs": [
      {
        "name": "bundleId",
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
    "name": "prepare",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
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
              },
              {
                "name": "nativeValue",
                "type": "uint256",
                "internalType": "uint256"
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
        "name": "reservation",
        "type": "tuple",
        "internalType": "struct ExecutionManager.Reservation",
        "components": [
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
          },
          {
            "name": "positionsBefore",
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
    "name": "prepareRecovery",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "adapter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "dataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expectedState",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "accountCall",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "records",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
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
        "name": "exposureLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reservedSlots",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "state",
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
    "name": "reservedPositionSlots",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "revokeSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sessionPermissions",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessions",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "permissionsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "perAction",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "spent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxExposure",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aggregateExposure",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "exposureSpent",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "generation",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sync",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "changed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "upgradeContractId",
    "inputs": [],
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
    "name": "verifyRecovery",
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
        "name": "adapter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "expectedState",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ActionPending",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pendingId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "market",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ActionReconciled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pendingId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ExecutionTypes.Status"
      },
      {
        "name": "filled",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "refunded",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "remaining",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "liability",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExecutionBoundBreached",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Initialized",
    "inputs": [
      {
        "name": "version",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SessionConfigured",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "key",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "permissionsHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadState",
    "inputs": []
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
  },
  {
    "type": "error",
    "name": "InvalidInitialization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotInitializing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
