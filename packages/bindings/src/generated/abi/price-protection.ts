export const priceProtectionAbi = [
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
    "name": "amountRules",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amountWord",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "inputDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "outputDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "inverse",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "maxInput",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "inputAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "outputAsset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bindCredit",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "maxSlippage",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bundleSealed",
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
    "name": "captureBalances",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "callIndex",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "inputBalance",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "outputBalance",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "value",
        "type": "tuple",
        "internalType": "struct PriceProtection.Rule",
        "components": [
          {
            "name": "oracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
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
            "name": "callIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "directionWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxAuthorizationAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumDirection",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumDirection",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureAmountRule",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "value",
        "type": "tuple",
        "internalType": "struct PriceProtection.Rule",
        "components": [
          {
            "name": "oracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
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
            "name": "callIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "directionWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxAuthorizationAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumDirection",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumDirection",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "amount",
        "type": "tuple",
        "internalType": "struct PriceProtection.AmountRule",
        "components": [
          {
            "name": "amountWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "inputDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "outputDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "inverse",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "maxInput",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "inputAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "outputAsset",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "integrationRegistry",
        "type": "address",
        "internalType": "address"
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
    "name": "creditBound",
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
    "name": "deriveAmountBound",
    "inputs": [
      {
        "name": "refPrice",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "inputDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "outputDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "inverse",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "maxInput",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "deriveBound",
    "inputs": [
      {
        "name": "refPrice",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "isMax",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "houseSlippage",
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
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "key",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "oracleCodeHashes",
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
    "name": "rule",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PriceProtection.Rule",
        "components": [
          {
            "name": "oracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
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
            "name": "callIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "priceWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "directionWord",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxAuthorizationAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumDirection",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumDirection",
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
    "name": "ruleHashes",
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
    "name": "validFunding",
    "inputs": [
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
        "name": "settlementAsset",
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "validate",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "quote",
        "type": "tuple",
        "internalType": "struct PriceProtection.Quote",
        "components": [
          {
            "name": "roundId",
            "type": "uint80",
            "internalType": "uint80"
          },
          {
            "name": "referencePrice",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "updatedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "authorizedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bound",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "slippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "isMax",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validateAmountResult",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "callIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "beforeInput",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "beforeOutput",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "RuleConfigured",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "market",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "ruleHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
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
  },
  {
    "type": "error",
    "name": "Stale",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
