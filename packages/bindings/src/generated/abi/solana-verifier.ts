export const solanaVerifierAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "lightClient_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sourceGenesis_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceProgram_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sourceProgramDataHash_",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "admission",
    "inputs": [],
    "outputs": [
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bootstrap",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "lightClient",
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
    "name": "lightClientCodeHash",
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
    "name": "proofLeaf",
    "inputs": [
      {
        "name": "proof",
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
    "name": "sourceChainId",
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
    "name": "sourceGenesis",
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
    "name": "sourceProgram",
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
    "name": "sourceProgramDataHash",
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
    "name": "verifiedLockRecord",
    "inputs": [
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
    "outputs": [
      {
        "name": "account",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lamports",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifiedRecoveryRecord",
    "inputs": [
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
    "outputs": [
      {
        "name": "account",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lamports",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
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
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "root",
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
    "name": "verifyReceiptInRoot",
    "inputs": [
      {
        "name": "receiptsRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "emitter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "eventDigest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "authorization",
        "type": "bool",
        "internalType": "bool"
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
    "name": "verifySolanaAction",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionDigest",
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
    "name": "verifySolanaCancellation",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifySolanaFunding",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nonce",
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
    "name": "verifySolanaFundingAbsence",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifySolanaLock",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockDigest",
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
    "name": "verifySolanaPayout",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nonce",
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
    "name": "verifySolanaPayoutAbsence",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actionHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifySolanaRefund",
    "inputs": [
      {
        "name": "header",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "genesis",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "program",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "programDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "lockPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recoveryPda",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "cumulativeRefunded",
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
    "type": "error",
    "name": "InvalidLightClient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSolanaProof",
    "inputs": []
  }
] as const;
