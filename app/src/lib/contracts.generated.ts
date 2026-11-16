// Generated from contracts/out (forge build). Regenerate after changing the contracts.

export const crispSignalAbi = [
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
      },
      {
        "name": "zkPassportVerifier",
        "type": "address",
        "internalType": "contract IZKPassportVerifier"
      },
      {
        "name": "domain_",
        "type": "string",
        "internalType": "string"
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
    "name": "ZKPASSPORT_VERIFIER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IZKPassportVerifier"
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
        "internalType": "struct CrispSignal.PollRequest",
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
            "name": "maxFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "policy",
            "type": "tuple",
            "internalType": "struct PassportRegistry.Policy",
            "components": [
              {
                "name": "minAge",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "nationalityRule",
                "type": "uint8",
                "internalType": "enum PassportRegistry.NationalityRule"
              },
              {
                "name": "countries",
                "type": "string[]",
                "internalType": "string[]"
              },
              {
                "name": "faceMatch",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "devMode",
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
    "name": "domain",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
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
        "internalType": "struct CrispSignal.Poll",
        "components": [
          {
            "name": "e3Id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "registry",
            "type": "address",
            "internalType": "contract PassportRegistry"
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
        "internalType": "struct CrispSignal.Poll[]",
        "components": [
          {
            "name": "e3Id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "registry",
            "type": "address",
            "internalType": "contract PassportRegistry"
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
        "name": "registry",
        "type": "address",
        "indexed": false,
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

export const passportRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "rootVerifier",
        "type": "address",
        "internalType": "contract IZKPassportVerifier"
      },
      {
        "name": "domain_",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "policy_",
        "type": "tuple",
        "internalType": "struct PassportRegistry.Policy",
        "components": [
          {
            "name": "minAge",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nationalityRule",
            "type": "uint8",
            "internalType": "enum PassportRegistry.NationalityRule"
          },
          {
            "name": "countries",
            "type": "string[]",
            "internalType": "string[]"
          },
          {
            "name": "faceMatch",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "devMode",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "PROOF_VALIDITY",
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
    "name": "ROOT_VERIFIER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IZKPassportVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "accountOf",
    "inputs": [
      {
        "name": "identifier",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "domain",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPastVotes",
    "inputs": [
      {
        "name": "account",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isRegistered",
    "inputs": [
      {
        "name": "account",
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
    "name": "policy",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PassportRegistry.Policy",
        "components": [
          {
            "name": "minAge",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nationalityRule",
            "type": "uint8",
            "internalType": "enum PassportRegistry.NationalityRule"
          },
          {
            "name": "countries",
            "type": "string[]",
            "internalType": "string[]"
          },
          {
            "name": "faceMatch",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "devMode",
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
    "name": "register",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IZKPassportVerifier.ProofVerificationParams",
        "components": [
          {
            "name": "version",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "proofVerificationData",
            "type": "tuple",
            "internalType": "struct IZKPassportVerifier.ProofVerificationData",
            "components": [
              {
                "name": "vkeyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "proof",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "publicInputs",
                "type": "bytes32[]",
                "internalType": "bytes32[]"
              }
            ]
          },
          {
            "name": "committedInputs",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "serviceConfig",
            "type": "tuple",
            "internalType": "struct IZKPassportVerifier.ServiceConfig",
            "components": [
              {
                "name": "validityPeriodInSeconds",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "domain",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "scope",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "devMode",
                "type": "bool",
                "internalType": "bool"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registrantAt",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "registrants",
    "inputs": [
      {
        "name": "start",
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
        "name": "page",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "scope",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalRegistrants",
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
    "name": "Registered",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AgeNotProven",
    "inputs": [
      {
        "name": "minAge",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "AlreadyRegistered",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DocumentAlreadyRegistered",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "FaceMatchMissing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPolicy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MissingIdentifier",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NationalityNotProven",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringsInsufficientHexLength",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedNullifierType",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongBinding",
    "inputs": [
      {
        "name": "senderAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const
