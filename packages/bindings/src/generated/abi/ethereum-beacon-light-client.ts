export const ethereumBeaconLightClientAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "trustedBeaconRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "checkpoint",
        "type": "tuple",
        "internalType": "struct EthereumBeaconSsz.BeaconHeader",
        "components": [
          {
            "name": "slot",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "proposerIndex",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "parentRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "stateRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bodyRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "committeeRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "committeeBranch",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "recoveryGovernance_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bootstrapHash",
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
    "name": "cancelCheckpoint",
    "inputs": [
      {
        "name": "trustedBeaconRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "chainId",
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
    "name": "checkpointGeneration",
    "inputs": [],
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
    "name": "checkpointRecoveryDelay",
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
    "name": "consensusVersion",
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
    "name": "currentCommitteeRoot",
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
    "name": "executionGeneration",
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
    "name": "finalizedBeaconRoot",
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
    "name": "finalizedCheckpointGeneration",
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
    "name": "finalizedCheckpoints",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "stateRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizedExecution",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "blockHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizedExecutionBlockHash",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "finalizedSlot",
    "inputs": [],
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
    "name": "finalizedStateRoot",
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
    "name": "fuluStartSlot",
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
    "name": "genesisTime",
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
    "name": "genesisValidatorsRoot",
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
    "name": "headerRoot",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "root",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "headerTimestamp",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "nextCommitteeRoot",
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
    "name": "pendingCheckpoints",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "slot",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "executeAfter",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "generation",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proofLeaf",
    "inputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "proofMaxAge",
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
    "name": "queueCheckpoint",
    "inputs": [
      {
        "name": "trustedBeaconRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverCheckpoint",
    "inputs": [
      {
        "name": "trustedBeaconRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "checkpoint",
        "type": "tuple",
        "internalType": "struct EthereumBeaconSsz.BeaconHeader",
        "components": [
          {
            "name": "slot",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "proposerIndex",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "parentRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "stateRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bodyRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "committeeRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "committeeBranch",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "executionBlockHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "executionBranch",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoveryGovernance",
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
    "name": "submitFinalizedBlock",
    "inputs": [
      {
        "name": "checkpointRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "beacon",
        "type": "tuple",
        "internalType": "struct EthereumBeaconSsz.BeaconHeader",
        "components": [
          {
            "name": "slot",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "proposerIndex",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "parentRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "stateRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bodyRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "blockRootBranch",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "executionBlockHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "executionBranch",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitUpdate",
    "inputs": [
      {
        "name": "update",
        "type": "tuple",
        "internalType": "struct EthereumBeaconLightClient.Update",
        "components": [
          {
            "name": "attested",
            "type": "tuple",
            "internalType": "struct EthereumBeaconSsz.BeaconHeader",
            "components": [
              {
                "name": "slot",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "proposerIndex",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "parentRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "stateRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "bodyRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "finalized",
            "type": "tuple",
            "internalType": "struct EthereumBeaconSsz.BeaconHeader",
            "components": [
              {
                "name": "slot",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "proposerIndex",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "parentRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "stateRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "bodyRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "finalityBranch",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          },
          {
            "name": "executionBlockHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "executionBranch",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          },
          {
            "name": "nextCommitteeRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nextCommitteeBranch",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          },
          {
            "name": "syncCommitteeBits",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signatureSlot",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "witness",
        "type": "tuple",
        "internalType": "struct EthereumBeaconLightClient.CommitteeWitness",
        "components": [
          {
            "name": "compressedPubkeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "aggregatePubkey",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "uncompressedParticipants",
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
    "name": "verifyEvent",
    "inputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "verifyFinality",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "verifyHistoricalFinality",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "verifyInclusion",
    "inputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "verifyLock",
    "inputs": [
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "weakSubjectivityWindow",
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
    "type": "event",
    "name": "CheckpointCancelled",
    "inputs": [
      {
        "name": "beaconRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CheckpointQueued",
    "inputs": [
      {
        "name": "beaconRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "executeAfter",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CheckpointRecovered",
    "inputs": [
      {
        "name": "beaconRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "executionBlockHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CommitteeLearned",
    "inputs": [
      {
        "name": "nextRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CommitteeRotated",
    "inputs": [
      {
        "name": "currentRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "nextRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Finalized",
    "inputs": [
      {
        "name": "beaconRoot",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "executionBlockHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "slot",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidBootstrap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSszProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidUpdate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
