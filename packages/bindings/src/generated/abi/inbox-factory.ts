export const inboxFactoryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "governance_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "create",
    "inputs": [
      {
        "name": "operationId",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "refundRecipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "inbox",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
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
    "name": "inboxOf",
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
    "name": "registrar",
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
    "name": "setRegistrar",
    "inputs": [
      {
        "name": "registrar_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "InboxCreated",
    "inputs": [
      {
        "name": "operationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "inbox",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RegistrarSet",
    "inputs": [
      {
        "name": "registrar",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "name": "Replay",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
