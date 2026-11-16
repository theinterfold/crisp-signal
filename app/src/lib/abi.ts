import { parseAbi } from 'viem'

export { crispSignalAbi, passportRegistryAbi } from './contracts.generated'

export const interfoldAbi = parseAbi([
  'struct E3 { uint256 seed; uint8 committeeSize; uint256 requestBlock; uint256[2] inputWindow; bytes32 encryptionSchemeId; address e3Program; uint8 paramSet; bytes customParams; address decryptionVerifier; address pkVerifier; bytes32 committeePublicKey; bytes32 ciphertextOutput; bytes plaintextOutput; address requester; bytes32 ciphertextCommitment; }',
  'struct E3RequestParams { uint8 committeeSize; uint256[2] inputWindow; address e3Program; uint8 paramSet; bytes computeProviderParams; bytes customParams; address expectedFeeToken; bytes32 expectedCryptoConfigId; uint256 maxFee; }',
  'function getE3(uint256 e3Id) view returns (E3)',
  'function getE3Stage(uint256 e3Id) view returns (uint8)',
  'function getE3Quote(E3RequestParams requestParams) view returns (uint256 fee)',
  'function feeToken() view returns (address)',
])

export const crispProgramAbi = parseAbi([
  'function publishInput(uint256 e3Id, bytes data)',
  'function ballotDigest(uint256 e3Id, address slot, bytes32 ciphertextCommitment) view returns (bytes32)',
  'function votingPowerOf(uint256 e3Id, address slot) view returns (uint256)',
  'function inputCommitmentDeadline(uint256 e3Id) view returns (uint256)',
  'function decodeTally(uint256 e3Id) view returns (uint256[] votes)',
  'function getRoundData(uint256 e3Id) view returns (uint256 merkleRoot, bytes32 paramsHash, uint256 numOptions, uint8 creditMode, uint256 inputRoot, uint40 numberOfVotes)',
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
