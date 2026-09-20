export const housePolicyGovernorAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vault_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "house_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "votingDelay_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "votingPeriod_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "timelock_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "quorumBps_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "proposalThreshold_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancel",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasVoted",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "house",
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
    "name": "proposalCount",
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
    "name": "proposalThreshold",
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
    "name": "proposals",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "proposer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "snapshotShares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "startAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "endAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "forVotes",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "againstVotes",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "eta",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "queued",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "cancelled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "policy",
        "type": "tuple",
        "internalType": "struct HousePolicyGovernor.Policy",
        "components": [
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
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "propose",
    "inputs": [
      {
        "name": "policy",
        "type": "tuple",
        "internalType": "struct HousePolicyGovernor.Policy",
        "components": [
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
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "queue",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quorumBps",
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
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHousePolicyRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "timelock",
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
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHousePolicyVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vote",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "support",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "votingDelay",
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
    "name": "votingPeriod",
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
    "name": "ProposalCancelled",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalCreated",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "proposer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "endAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalExecuted",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalQueued",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "eta",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VoteCast",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "support",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "weight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyVoted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Executed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Invalid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoVotingPower",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Quorum",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Threshold",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VotingClosed",
    "inputs": []
  }
] as const;
