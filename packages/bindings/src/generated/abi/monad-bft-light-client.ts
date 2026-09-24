export const monadBftLightClientAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "chainId_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "consensusVersion_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "proofMaxAge_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bootstrapHash_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bootstrapSequence_",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "bootstrapEpoch_",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "validatorSetHash_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "epochCommitter_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bootstrapEpoch",
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
    "name": "epochCommitter",
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
    "name": "execution",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "receiptsRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "timestamp",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "number",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "epoch",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizedConsensus",
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
    "name": "finalizedExecutionReceiptsRoot",
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
        "name": "",
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
    "name": "knownSequence",
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
    "name": "latestEpoch",
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
    "name": "submitCertified",
    "inputs": [
      {
        "name": "parentHeader",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "childHeader",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "parentQc",
        "type": "tuple",
        "internalType": "struct MonadBftLightClient.QcProof",
        "components": [
          {
            "name": "signerBits",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "compressedKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "validatorKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "stakes",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "childQc",
        "type": "tuple",
        "internalType": "struct MonadBftLightClient.QcProof",
        "components": [
          {
            "name": "signerBits",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "compressedKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "validatorKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "stakes",
            "type": "uint256[]",
            "internalType": "uint256[]"
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
    "name": "submitFinalized",
    "inputs": [
      {
        "name": "parentHeader",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "childHeader",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "parentQc",
        "type": "tuple",
        "internalType": "struct MonadBftLightClient.QcProof",
        "components": [
          {
            "name": "signerBits",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "compressedKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "validatorKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "stakes",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "childQc",
        "type": "tuple",
        "internalType": "struct MonadBftLightClient.QcProof",
        "components": [
          {
            "name": "signerBits",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "compressedKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "validatorKeys",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "stakes",
            "type": "uint256[]",
            "internalType": "uint256[]"
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
    "name": "submitValidatorSet",
    "inputs": [
      {
        "name": "epoch",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "setHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "executionHeader",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "receiptProof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "validatorSetHash",
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
    "name": "validatorSetHashOfEpoch",
    "inputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
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
    "type": "event",
    "name": "ConsensusCertified",
    "inputs": [
      {
        "name": "blockId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sequence",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ConsensusFinalized",
    "inputs": [
      {
        "name": "blockId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sequence",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExecutionFinalized",
    "inputs": [
      {
        "name": "blockId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "number",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "receiptsRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ValidatorSetLearned",
    "inputs": [
      {
        "name": "epoch",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "setHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InputTooLong",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Invalid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidHeader",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  }
] as const;
