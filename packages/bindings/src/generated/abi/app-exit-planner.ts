export const appExitPlannerAbi = [
  {
    "type": "function",
    "name": "nextExitStep",
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
        "name": "retryAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
] as const;
