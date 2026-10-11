export const useCaseRecoveryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "core_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reader_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "canExit",
    "inputs": [
      {
        "name": "id",
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
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configurationHashes",
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
    "name": "configure",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "rules",
        "type": "tuple[]",
        "internalType": "struct UseCaseRecovery.Template[]",
        "components": [
          {
            "name": "phase",
            "type": "uint8",
            "internalType": "enum UseCaseRecovery.Phase"
          },
          {
            "name": "market",
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
            "name": "words",
            "type": "tuple[]",
            "internalType": "struct UseCaseRecovery.Word[]",
            "components": [
              {
                "name": "source",
                "type": "uint8",
                "internalType": "enum UseCaseRecovery.Source"
              },
              {
                "name": "value",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "input",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "output",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "spendField",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "minimumField",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "asynchronous",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "pendingStatus",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
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
        "internalType": "contract TermbookCore"
      }
    ],
    "stateMutability": "view"
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
    "name": "nextExitStep",
    "inputs": [
      {
        "name": "id",
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      },
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
    "name": "reader",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract UseCaseReader"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recoveryCall",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
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
    "name": "recoverySpend",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
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
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "id",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "verifyRecovery",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "expected",
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
    "type": "error",
    "name": "Invalid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Overflow",
    "inputs": []
  }
] as const;
