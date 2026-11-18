import { parseAbi } from 'viem'

export { crispSignalAztecAbi } from './contracts.generated'

export const interfoldAbi = parseAbi([
  'struct E3 { uint256 seed; uint8 committeeSize; uint256 requestBlock; uint256[2] inputWindow; bytes32 encryptionSchemeId; address e3Program; uint8 paramSet; bytes customParams; address decryptionVerifier; address pkVerifier; bytes32 committeePublicKey; bytes32 ciphertextOutput; bytes plaintextOutput; address requester; bytes32 ciphertextCommitment; }',
  'struct E3RequestParams { uint8 committeeSize; uint256[2] inputWindow; address e3Program; uint8 paramSet; bytes computeProviderParams; bytes customParams; address expectedFeeToken; bytes32 expectedCryptoConfigId; uint256 maxFee; }',
  'function getE3(uint256 e3Id) view returns (E3)',
  'function getE3Stage(uint256 e3Id) view returns (uint8)',
  'function getE3Quote(E3RequestParams requestParams) view returns (uint256 fee)',
  'function feeToken() view returns (address)',
  'struct E3TimeoutConfig { uint256 dkgWindow; uint256 computeWindow; uint256 decryptionWindow; }',
  'function getTimeoutConfig() view returns (E3TimeoutConfig)',
  'function maxDuration() view returns (uint256)',
  'function ciphernodeRegistry() view returns (address)',
])

export const ciphernodeRegistryAbi = parseAbi([
  'function randomnessRequestTimeout() view returns (uint256)',
  'function sortitionSubmissionWindow() view returns (uint256)',
])

/** The part of `CRISPAztecProgram` (and its `CRISPRemoteProgram` base) the app reads. */
export const crispAztecProgramAbi = parseAbi([
  'function interfold() view returns (address)',
  'function l2Program() view returns (bytes32)',
  'function scopeOf(uint256 e3Id) view returns (string)',
  'function scopeHashOf(uint256 e3Id) view returns (uint256)',
  'function decodeTally(uint256 e3Id) view returns (uint256[] votes)',
  'function minVotingDuration() view returns (uint256)',
  'function remoteFinalityWindow() view returns (uint256)',
  'struct Round { bytes32 paramsHash; uint256 numOptions; uint256 inputLimit; bool keyRelayed; bool rootSubmitted; uint256 inputRoot; uint256 numInputs; }',
  'function getRound(uint256 e3Id) view returns (Round)',
  'event InputRootSubmitted(uint256 indexed e3Id, uint256 inputRoot, uint256 numInputs)',
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

export const faucetAbi = parseAbi(['function faucet()'])

/** Mirrors `IInterfold.E3Stage`. */
export enum E3Stage {
  None,
  Requested,
  CommitteeFinalized,
  KeyPublished,
  CiphertextReady,
  Complete,
  Failed,
}
