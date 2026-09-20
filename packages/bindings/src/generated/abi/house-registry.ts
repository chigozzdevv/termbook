export const houseRegistryAbi = [
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
    "name": "disable",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
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
    "name": "houseOfVault",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "houses",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "manager",
        "type": "address",
        "internalType": "address"
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
    "name": "isActiveHouse",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault",
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
    "name": "policies",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minMaturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxMaturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxAprBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxOriginationFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxCommitmentFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "initialBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maintenanceBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "watchBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "freezeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "liquidationBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "riskConfigured",
        "type": "bool",
        "internalType": "bool"
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
    "name": "register",
    "inputs": [
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
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "manager",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPolicy",
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
        "name": "maxLimit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minMaturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxMaturity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxAprBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxOriginationFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxCommitmentFeeBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRiskPolicy",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maintenanceBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "watchBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "freezeBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "liquidationBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "HouseDisabled",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HouseRegistered",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PolicySet",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RiskPolicySet",
    "inputs": [
      {
        "name": "house",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "initialBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "liquidationBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
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
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
