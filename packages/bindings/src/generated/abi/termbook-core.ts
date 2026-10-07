export const termbookCoreAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "guardian_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "risk_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "execution_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reservations_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "prices_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "SOLANA_NATIVE_ASSET_ID",
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
    "name": "abort",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "accept",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revolving",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "setupDeadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grace",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "houseNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "houseSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptQuote",
    "inputs": [
      {
        "name": "quote",
        "type": "tuple",
        "internalType": "struct Types.Quote",
        "components": [
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "intentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "house",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceChain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "collateralVault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "returnRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "limit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bundleId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "setupDeadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maturity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gracePeriod",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reservationBond",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revolving",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "aprBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "originationFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "commitmentFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reservationPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bondPayer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bondRefundRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptSolanaQuote",
    "inputs": [
      {
        "name": "solana",
        "type": "tuple",
        "internalType": "struct Types.SolanaQuote",
        "components": [
          {
            "name": "quote",
            "type": "tuple",
            "internalType": "struct Types.Quote",
            "components": [
              {
                "name": "borrower",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "owner",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "intentId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "house",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "vault",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "sourceChain",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "collateralVault",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "collateralAsset",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "collateralAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "returnRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "settlementAsset",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "limit",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "bundleId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "setupDeadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "maturity",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "gracePeriod",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "reservationBond",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "expiry",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "termsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "revolving",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "aprBps",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "originationFee",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "commitmentFeeBps",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "reservationPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "bondPayer",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "bondRefundRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "sourceGenesis",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceVault",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceAsset",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceOwner",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "returnRecipient",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recoveryVault",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "verifierVersion",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptWithBond",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revolving",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "setupDeadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grace",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reservationBond",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "houseNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "houseSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptWithTerms",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revolving",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "setupDeadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grace",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsReservationBond",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "houseNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "aprBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "originationFee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "commitmentFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "houseSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptedCredits",
    "inputs": [],
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
    "name": "accrue",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "actionHealthBlocked",
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
    "name": "addCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "advanceClose",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expectedStepId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "appRecoveryAdapterCodeHash",
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
    "name": "appRecoveryAdapterOfBundle",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "applySettlement",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "inbox",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approvedCalls",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "authorizeRemoteSeizure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "authorizeReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "authorizeSolanaRecoveryFund",
    "inputs": [
      {
        "name": "funding",
        "type": "tuple",
        "internalType": "struct TermbookCore.SolanaRecoveryFunding",
        "components": [
          {
            "name": "creditId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "operationId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "inbox",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "depositPubkey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quoteHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "operation",
        "type": "tuple",
        "internalType": "struct InboxFactory.Operation",
        "components": [
          {
            "name": "operationId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "payer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceChain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sourceAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "creditId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "maxAmountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxReceived",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sourceRefund",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "refundRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "routeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "routeVersion",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "lpRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minShares",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "routeSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "riskSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "authorizeSolanaRecoveryReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "authorizeSourceRecoveryReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "bindAccount",
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindLateRemoteCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "returnRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindRemoteCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindSolanaCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "bondSettled",
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
    "name": "bundleEverUsed",
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
    "name": "cancelExpiredCollateralTopUp",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelExpiredRemoteReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelExpiredRemoteSeizure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelExpiredSolanaRecoveryFund",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelExpiredSolanaRecoveryReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelRefundedRecoveryOperation",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "closeStep",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "done",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "retryAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "closingRetention",
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
    "name": "collateralActionOutcome",
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
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collateralOwnerOf",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collateralProven",
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
    "name": "collateralSourceChainOf",
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
    "name": "commitFullRecovery",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "commitmentFeeRemainder",
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
    "name": "completedExitSteps",
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
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configureEthereumWormhole",
    "inputs": [
      {
        "name": "wormhole",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureExecutionAmountPrice",
    "inputs": [
      {
        "name": "bundleId",
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
        "name": "rule",
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
        "name": "amountRule",
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureExecutionPolicy",
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
    "name": "configureExecutionPrice",
    "inputs": [
      {
        "name": "bundleId",
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
        "name": "rule",
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
    "name": "configureExecutionSession",
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
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureReservationPolicy",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "policy",
        "type": "tuple",
        "internalType": "struct ReservationManager.Policy",
        "components": [
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "maxSetupDuration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "annualRateBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxBorrowerCount",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxHouseCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxBorrowerLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxHouseLimit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "readyFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "abandonFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiryFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "repeatPenalty",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureRisk",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "initial_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maintenance_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "watch_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "freeze_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "liquidation_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureSolanaRecoveryFunding",
    "inputs": [
      {
        "name": "factory",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "routeSigner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "riskSigner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureSolanaWormhole",
    "inputs": [
      {
        "name": "wormhole",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmCollateralTopUp",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmRemoteRecoveryClearance",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmRemoteReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmRemoteSeizure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmSolanaRecoveryFund",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmSolanaRecoveryReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "creditAccount",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creditBorrower",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creditDebt",
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
    "name": "creditDetails",
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
        "type": "tuple",
        "internalType": "struct TermbookCore.Credit",
        "components": [
          {
            "name": "facility",
            "type": "uint8",
            "internalType": "enum Types.Facility"
          },
          {
            "name": "payment",
            "type": "uint8",
            "internalType": "enum Types.Payment"
          },
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "house",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralVault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "returnRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "limit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "debt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "drawn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maturity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "grace",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "setupDeadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reservationBond",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "revision",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "recovery",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bundleId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "collateralBound",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "collateralReturned",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "recoveryFinalized",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "revolving",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "principal",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accruedInterest",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accruedFees",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "aprBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "originationFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "commitmentFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "policyVersion",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifierVersion",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifierCodeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "accruedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "originationCharged",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creditFacility",
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
        "type": "uint8",
        "internalType": "enum Types.Facility"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creditFreeCash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "cash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creditRevision",
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
    "name": "creditVault",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "disableLocalSalePolicy",
    "inputs": [
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
    "name": "disableRemoteSalePolicy",
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
    "name": "disableSolanaMarket",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "domain",
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
    "name": "draw",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBound",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "drawWithSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBound",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sessionKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sessionNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sessionSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ethereumAuthorizationPublished",
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
    "name": "ethereumAuthorizationSequenceOf",
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
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ethereumWormholeCodeHash",
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
    "name": "ethereumWormholeCore",
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
    "name": "executeAction",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBound",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeFundedAction",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "drawAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "spendAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBound",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerNonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executePlan",
    "inputs": [
      {
        "name": "creditId",
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
        "name": "auth",
        "type": "tuple",
        "internalType": "struct TermbookCore.ExecutionAuthorization",
        "components": [
          {
            "name": "drawAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxDraw",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "revision",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "price",
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
        ]
      }
    ],
    "outputs": [
      {
        "name": "results",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executionDigest",
    "inputs": [
      {
        "name": "creditId",
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
        "name": "auth",
        "type": "tuple",
        "internalType": "struct TermbookCore.ExecutionAuthorization",
        "components": [
          {
            "name": "drawAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxDraw",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "revision",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "signer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "price",
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
        ]
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
    "name": "executionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ExecutionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "executionVersion",
    "inputs": [],
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
    "name": "exitApp",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "exitPlannerCodeHash",
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
    "name": "exitPlannerOfBundle",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exitVerifierCodeHash",
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
    "name": "exitVerifierOfBundle",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expireSetup",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeRecovery",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finishClose",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finishLiquidation",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fullTermination",
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
    "name": "guardian",
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
    "name": "healthMaxAge",
    "inputs": [],
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
    "name": "healthSnapshot",
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
        "type": "tuple",
        "internalType": "struct Types.HealthSnapshot",
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
            "name": "recoveryValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "healthBps",
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
    "name": "healthSnapshotAt",
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
    "name": "healthSnapshotRevision",
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
    "name": "healthSource",
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
    "name": "houseNonces",
    "inputs": [
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
    "name": "houseRegistry",
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
    "name": "integrationRegistry",
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
    "name": "intentUsed",
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
    "name": "interestRemainder",
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
    "name": "isReady",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastRemoteSeizureHash",
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
    "name": "localCollateralVaultCodeHash",
    "inputs": [
      {
        "name": "",
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "localSaleMarketId",
    "inputs": [
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "localSalePolicies",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "oracleRegistry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "minimumPriceBps",
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
        "name": "maxCollateralPerSale",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "collateralCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "settlementCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "oracleCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "lockBound",
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
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lockReturned",
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
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "managedBundle",
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
    "name": "markDefaulted",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markMatured",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markSetupProtocolFailure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "minimumRemoteRecoveryProceeds",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralAmount",
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
    "name": "nonceUsed",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "paused",
    "inputs": [],
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
    "name": "pendingCollateralTopUp",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "revision",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingRemoteReturn",
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
    "name": "pendingRemoteSeizure",
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
    "name": "pendingSolanaFundingAmount",
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
    "name": "pendingSolanaFundingDeadline",
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
    "name": "pendingSolanaFundingHash",
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
    "name": "pendingSolanaFundingNonce",
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
    "name": "pendingSolanaFundingOperation",
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
    "name": "pendingSolanaPayoutAmount",
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
    "name": "pendingSolanaPayoutDeadline",
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
    "name": "pendingSolanaPayoutHash",
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
    "name": "pendingSolanaPayoutNonce",
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
    "name": "previewAction",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerNonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "previewFundedAction",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "drawAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "spendAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrowerNonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "previewHealth",
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
        "type": "tuple",
        "internalType": "struct Types.HealthSnapshot",
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
            "name": "recoveryValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "healthBps",
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
    "name": "previewPlan",
    "inputs": [
      {
        "name": "creditId",
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
        "name": "drawAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "price",
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
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "previewVaultAccrual",
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
    "name": "priceProtection",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract PriceProtection"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proveCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "proveSolanaCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quoteDigest",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revolving",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "setupDeadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grace",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reservationBond",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsHash",
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
    "name": "quoteDigestFull",
    "inputs": [
      {
        "name": "quote",
        "type": "tuple",
        "internalType": "struct Types.Quote",
        "components": [
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "intentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "house",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sourceChain",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "collateralVault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "returnRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "limit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bundleId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "setupDeadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maturity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gracePeriod",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reservationBond",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revolving",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "aprBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "originationFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "commitmentFeeBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reservationPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bondPayer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bondRefundRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
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
    "name": "quoteDigestWithTerms",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revolving",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "setupDeadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "grace",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reservationBond",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "aprBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "originationFee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "commitmentFeeBps",
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
    "name": "reconcileSolanaRecoveryRefund",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "cumulativeRefunded",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recordHealth",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recordRecovery",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverAccountCash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverApp",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "instruction",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverLocalCollateralWithBid",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settlementAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoveryKeepers",
    "inputs": [
      {
        "name": "",
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
    "name": "recoveryPaidAtStart",
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
    "name": "recoveryRefundRecipientOf",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "releaseLiquidatedAccount",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "remoteActionNonce",
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
    "name": "remoteCollateral",
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
    "name": "remoteRecoveryCleared",
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
    "name": "remoteRecoveryContext",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sourceAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recoveryVault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "remoteRecoveryVaultOf",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "remoteReturnActionHash",
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
    "name": "remoteReturnDeadline",
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
    "name": "remoteReturnDeducted",
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
    "name": "remoteReturnRevision",
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
    "name": "remoteSaleMarketId",
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
    "name": "remoteSalePolicies",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "oracleRegistry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "minimumPriceBps",
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
        "name": "maxCollateralPerRoute",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "settlementCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "oracleCodeHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "remoteSeizureActionHash",
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
    "name": "remoteSeizureConfirmed",
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
    "name": "remoteSeizureDeadline",
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
    "name": "remoteSeizureRecipient",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "remoteSeizureRevision",
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
    "name": "repay",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "repayAvailableCash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "repayFromAccount",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "repayUpTo",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "maxAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "fromAccount",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "requireFull",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "paid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "repaymentQuote",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "debt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "republishEthereumAuthorization",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "republishEthereumRecoveryReturn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "reservationManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ReservationManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "retentionPlannerCodeHash",
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
    "name": "retentionPlannerOfBundle",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "retentionSupported",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "retentionVerifierCodeHash",
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
    "name": "retentionVerifierOfBundle",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "retireRefundedSolanaRecoveryOperation",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeExecutionSession",
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
    "name": "revokeSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sessionKey",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "riskEngine",
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
    "name": "sessionCapabilityLimit",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionCapabilityOf",
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionExpiry",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionGeneration",
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
    "name": "sessionGenerationAt",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionLimits",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionNonces",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionSpent",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionTotalLimit",
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
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setAppRecoveryAdapter",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "adapter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setApprovedCall",
    "inputs": [
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
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "returnRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCollateralPauseGuardian",
    "inputs": [
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "pauseGuardian",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setCollateralWithOwner",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "returnRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setExitPlanner",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "planner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setExitVerifier",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGovernance",
    "inputs": [
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGuardian",
    "inputs": [
      {
        "name": "guardian_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHealthMaxAge",
    "inputs": [
      {
        "name": "maxAge",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHealthSource",
    "inputs": [
      {
        "name": "source",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHouseProtocolFee",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "feeBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setHouseRegistry",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setIntegrationRegistry",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLocalCollateralVault",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "codeHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLocalSalePolicy",
    "inputs": [
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
        "name": "oracleRegistry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "priceId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "minimumPriceBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxCollateralPerSale",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "value",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRecoveryKeeper",
    "inputs": [
      {
        "name": "keeper",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRemoteCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "returnRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRemoteSalePolicy",
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
        "name": "oracleRegistry",
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
        "name": "minimumPriceBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxCollateralPerRoute",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRetentionPlanner",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "planner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRetentionVerifier",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRisk",
    "inputs": [
      {
        "name": "risk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSession",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sessionKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "capability",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "perAction",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSessionWithTotal",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sessionKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "capability",
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
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSolanaMarket",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sourceGenesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSourceCollateralVault",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateralVault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSourceRecoveryVault",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recoveryVault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setVerifierRegistry",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setupFailureEvidence",
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
    "name": "solanaActionHash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revision",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
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
    "name": "solanaAlias",
    "inputs": [
      {
        "name": "sourceGenesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "identity",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "solanaCollateral",
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
    "name": "solanaIdentityOf",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "sourceGenesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceAsset",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceOwner",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "returnRecipient",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryVault",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "verifierVersion",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "solanaLockDigest",
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
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "solanaLockPdaOf",
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
    "name": "solanaMarkets",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "sourceGenesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceAsset",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "solanaQuoteDigest",
    "inputs": [
      {
        "name": "quote",
        "type": "tuple",
        "internalType": "struct Types.SolanaQuote",
        "components": [
          {
            "name": "quote",
            "type": "tuple",
            "internalType": "struct Types.Quote",
            "components": [
              {
                "name": "borrower",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "owner",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "intentId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "house",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "vault",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "sourceChain",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "collateralVault",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "collateralAsset",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "collateralAmount",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "returnRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "settlementAsset",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "limit",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "bundleId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "setupDeadline",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "maturity",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "gracePeriod",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "reservationBond",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "expiry",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "termsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "revolving",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "aprBps",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "originationFee",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "commitmentFeeBps",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "reservationPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "bondPayer",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "bondRefundRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
              }
            ]
          },
          {
            "name": "sourceGenesis",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceVault",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceAsset",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sourceOwner",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "returnRecipient",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recoveryVault",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "verifierVersion",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
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
    "name": "solanaRecoveryAllocated",
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
    "name": "solanaRecoveryFactory",
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
    "name": "solanaRecoveryFactoryCodeHash",
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
    "name": "solanaRecoveryFundHash",
    "inputs": [
      {
        "name": "funding",
        "type": "tuple",
        "internalType": "struct TermbookCore.SolanaRecoveryFunding",
        "components": [
          {
            "name": "creditId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "operationId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "inbox",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "depositPubkey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quoteHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "operationDigest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revision",
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
    "name": "solanaRecoveryOperationAmount",
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
    "name": "solanaRecoveryOperationConfirmed",
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
    "name": "solanaRecoveryOperationFunded",
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
    "name": "solanaRecoveryRefunded",
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
    "name": "solanaRecoveryRetiredRefunds",
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
    "name": "solanaRecoveryReturnHash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "revision",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
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
    "name": "solanaRiskSigner",
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
    "name": "solanaRouteSigner",
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
    "name": "solanaSeizedAmount",
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
    "name": "solanaWormholeCodeHash",
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
    "name": "solanaWormholeCore",
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
    "name": "sourceCollateralVault",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "sourceRecoveryReturnCreditOf",
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
    "name": "sourceRecoveryReturnDeadlineOf",
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
    "name": "sourceRecoveryReturnHash",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
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
    "name": "sourceRecoveryVault",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "name": "startClosing",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "startLiquidation",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "startRetaining",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "syncActions",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vaultEverUsed",
    "inputs": [
      {
        "name": "",
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
    "name": "verifiedRecoveryPaid",
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
    "name": "verifierRegistry",
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
    "name": "withdraw",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawCollateral",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "event",
    "name": "ActionExecuted",
    "inputs": [
      {
        "name": "creditId",
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
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ActionsReconciled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "revision",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "healthBlocked",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AppExitStep",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "adapter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "callHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AppRecoveryAdapterSet",
    "inputs": [
      {
        "name": "bundleId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "adapter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AppRecoveryStep",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "adapter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "callHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Closed",
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
    "name": "ClosureSelected",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "retain",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CollateralAdded",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CollateralBound",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CollateralReturned",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CollateralTopUpCancelled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreditAborted",
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
    "name": "CreditCreated",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "house",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreditReady",
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
    "name": "Cured",
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
    "name": "Drawn",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FullRecoveryCommitted",
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
    "name": "Liquidated",
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
    "name": "LiquidationStarted",
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
    "name": "LocalCollateralSold",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collateralAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "settlementAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LocalCollateralVaultSet",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "codeHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LocalSalePolicyDisabled",
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
    "name": "LocalSalePolicySet",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "collateralAsset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "settlementAsset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RecoveryFinalized",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "remainingDebt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RecoveryPayment",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteActionAuthorized",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteReturnCancelled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteReturnRequested",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lockId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteSalePolicyDisabled",
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
    "name": "RemoteSalePolicySet",
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
        "name": "collateralAsset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteSeizureCancelled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemoteSeizureConfirmed",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Repaid",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetupProtocolFailure",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaMarketSet",
    "inputs": [
      {
        "name": "sourceChain",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "sourceGenesis",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "programId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryFundAuthorized",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "inbox",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "depositPubkey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "quoteHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "revision",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryFundCancelled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryFundConfirmed",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryFundingConfigured",
    "inputs": [
      {
        "name": "factory",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "routeSigner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "riskSigner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryOperationRetired",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "operationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "refundAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryPayoutCancelled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryPayoutConfirmed",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryRefundReconciled",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "cumulativeRefunded",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaRecoveryReturnAuthorized",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "recipient",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "revision",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SolanaWormholeConfigured",
    "inputs": [
      {
        "name": "wormhole",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SourceRecoveryReturnAuthorized",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "ActionPreview",
    "inputs": [
      {
        "name": "healthBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "initialBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recoveryValue",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadHealth",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Frozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAccount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAuthority",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCollateral",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTerms",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OverLimit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Pending",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RecoveryIncomplete",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Used",
    "inputs": []
  }
] as const;
