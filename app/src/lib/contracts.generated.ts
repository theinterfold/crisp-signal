// Generated from contracts/out (forge build). Regenerate after changing the contracts.

export const crispSignalAztecAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "interfold",
        "type": "address",
        "internalType": "contract IInterfold"
      },
      {
        "name": "crispProgram",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "CRISP_PROGRAM",
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
    "name": "INTERFOLD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IInterfold"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimRefund",
    "inputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "createPoll",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct CrispSignalAztec.PollRequest",
        "components": [
          {
            "name": "metadataCid",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "numOptions",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "inputWindow",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "committeeSize",
            "type": "uint8",
            "internalType": "enum IInterfold.CommitteeSize"
          },
          {
            "name": "paramSet",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "computeProviderParams",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "expectedCryptoConfigId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "minAge",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "allowMockDocuments",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "maxFee",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "e3Id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getPoll",
    "inputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct CrispSignalAztec.Poll",
        "components": [
          {
            "name": "e3Id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeToken",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "metadataCid",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPolls",
    "inputs": [
      {
        "name": "before",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "page",
        "type": "tuple[]",
        "internalType": "struct CrispSignalAztec.Poll[]",
        "components": [
          {
            "name": "e3Id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feeToken",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "metadataCid",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pollCount",
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
    "name": "PollCreated",
    "inputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "e3Id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "metadataCid",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundForwarded",
    "inputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "type": "error",
    "name": "FeeAboveMax",
    "inputs": [
      {
        "name": "fee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidConfiguration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MissingMetadata",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotCreator",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownPoll",
    "inputs": [
      {
        "name": "pollId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const
