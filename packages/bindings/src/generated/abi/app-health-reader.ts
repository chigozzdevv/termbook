export const appHealthReaderAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "core_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "bundleId_",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "collateralReader_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "appReader_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recoveryAdapter_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_PENDING",
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
    "name": "MAX_POSITIONS",
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
    "name": "appReader",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAppValueReader"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "appReaderCodeHash",
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
    "name": "bundleId",
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
    "name": "collateralReader",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHealthReader"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collateralReaderCodeHash",
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
    "name": "readHealth",
    "inputs": [
      {
        "name": "creditId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "revision",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "debt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "oracleRegistry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "reading",
        "type": "tuple",
        "internalType": "struct HealthReading",
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
            "name": "observedAt",
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
    "name": "recoveryAdapter",
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
    "name": "recoveryAdapterCodeHash",
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
    "type": "error",
    "name": "Invalid",
    "inputs": []
  }
] as const;
