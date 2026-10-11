export const useCaseReaderAbi = [
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
        "name": "registry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "programs_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "assetValue",
    "inputs": [
      {
        "name": "asset",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Asset",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "oracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feed",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maximum",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "dust",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "quoteProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "quoteTarget",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settlementDecimals",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balance",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "config",
    "inputs": [
      {
        "name": "bundle",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Config",
        "components": [
          {
            "name": "useCase",
            "type": "uint8",
            "internalType": "enum UseCaseReader.UseCase"
          },
          {
            "name": "settlement",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "stateTarget",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "metaProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "positionProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "pendingProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reconcileProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "retainedBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "recoveryCosts",
            "type": "uint128",
            "internalType": "uint128"
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
            "name": "maxRequests",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "assets",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Asset[]",
            "components": [
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "oracle",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "feed",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "decimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "maximum",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "dust",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteProgram",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "quoteTarget",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "markets",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Market[]",
            "components": [
              {
                "name": "id",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "receipt",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "asset0",
                "type": "tuple",
                "internalType": "struct UseCaseReader.Asset",
                "components": [
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "oracle",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "feed",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "decimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "maximum",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "dust",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "quoteProgram",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "quoteTarget",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "asset1",
                "type": "tuple",
                "internalType": "struct UseCaseReader.Asset",
                "components": [
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "oracle",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "feed",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "decimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "maximum",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "dust",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "quoteProgram",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "quoteTarget",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "maximumExposure",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          },
          {
            "name": "orderTracker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "custody",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Custody[]",
            "components": [
              {
                "name": "target",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "program",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "maximum",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "dust",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ]
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
        "name": "value",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Config",
        "components": [
          {
            "name": "useCase",
            "type": "uint8",
            "internalType": "enum UseCaseReader.UseCase"
          },
          {
            "name": "settlement",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "stateTarget",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "metaProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "positionProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "pendingProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reconcileProgram",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "retainedBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "recoveryCosts",
            "type": "uint128",
            "internalType": "uint128"
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
            "name": "maxRequests",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "assets",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Asset[]",
            "components": [
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "oracle",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "feed",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "decimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "maximum",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "dust",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteProgram",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "quoteTarget",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "markets",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Market[]",
            "components": [
              {
                "name": "id",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "receipt",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "asset0",
                "type": "tuple",
                "internalType": "struct UseCaseReader.Asset",
                "components": [
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "oracle",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "feed",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "decimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "maximum",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "dust",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "quoteProgram",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "quoteTarget",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "asset1",
                "type": "tuple",
                "internalType": "struct UseCaseReader.Asset",
                "components": [
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "oracle",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "feed",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "decimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "maximum",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "dust",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "quoteProgram",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "quoteTarget",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "maximumExposure",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          },
          {
            "name": "orderTracker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "custody",
            "type": "tuple[]",
            "internalType": "struct UseCaseReader.Custody[]",
            "components": [
              {
                "name": "target",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "program",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "maximum",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "dust",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
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
    "name": "custodyBalance",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "meta",
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
        "name": "result",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Meta",
        "components": [
          {
            "name": "positions",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "pending",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requests",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reserved",
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
    "name": "order",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "result",
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
    "name": "pendingAt",
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
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
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
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingCount",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingDetails",
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
        "name": "pendingId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "market",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "input",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "venueId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingExposure",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "position",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Position",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "id",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "market",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "quantity0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity1",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rewards0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rewards1",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "margin",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "notional",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "pnl",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "liability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "executableValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "shares",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "staked",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liquidity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimableAt",
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
    "name": "positionAt",
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
    "name": "positionCount",
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
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionValue",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "programs",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ReadProgram"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "readAppValue",
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
        "name": "settlement",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "netValue",
        "type": "int256",
        "internalType": "int256"
      },
      {
        "name": "retained",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "costs",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "observedAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reconcile",
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
        "name": "pendingId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "result",
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
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IntegrationRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "request",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct UseCaseReader.Request",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "id",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "market",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "quantity0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity1",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "executableValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimableAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "replacesPositionId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requestValue",
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
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reservedCash",
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
        "name": "settlement",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
