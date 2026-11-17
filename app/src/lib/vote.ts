import {
  CrispSDK,
  finishBallotProof,
  finishMaskProof,
  getRoundBfvParams,
  getZeroVote,
  isCommitteeKeyAuthentic,
  prepareBallot,
  registeredPreset,
  setCircuits,
  slotHeadIndex,
  type CircuitBundle,
  type CircuitPreset,
  type ProofStage,
  type SlotHead,
} from '@crisp-e3/sdk'
import type { CastArguments, Census, CompressedProofResult, CrispAztec, InputAttestation } from '@crisp-e3/aztec'
import { bytesToHex, hexToBytes, keccak256, recoverAddress, type Address, type Hex } from 'viem'
import { sign } from 'viem/accounts'
import { CHAIN, CRISP_SERVER_URL, INTERFOLD_ADDRESS, RPC_URL } from '../config'
import { interfoldAbi } from './abi'
import { getClient, loadDeployment, loadServerConfig, loadSdk, slotKeys, invalidateLogs } from './aztec'
import { publicClient } from './wagmi'

export type VoteStep = 'connecting' | 'encrypting' | 'proving' | 'staging' | 'sending' | 'done'

export type VoteProgress = { step: VoteStep; detail?: string; proofStage?: ProofStage; proofIndex?: number; proofTotal?: number }

const CIRCUITS: Record<number, { preset: CircuitPreset; load: () => Promise<{ loadCircuits: () => Promise<CircuitBundle> }> }> = {
  0: { preset: 'insecure-64', load: () => import('@crisp-e3/sdk/insecure-64') },
  2: { preset: 'secure-8192', load: () => import('@crisp-e3/sdk/secure-8192') },
}
let loading: { preset: CircuitPreset; done: Promise<void> } | undefined

/** Installs the circuits of a round's parameter set, once per session. */
async function ensureCircuits(paramSet: number) {
  const entry = CIRCUITS[paramSet]
  if (!entry) throw new Error(`This poll uses parameter set ${paramSet}, which this app has no circuits for.`)
  const active = registeredPreset() ?? loading?.preset
  // Proving against circuits of another preset produces ballots the verifier rejects.
  if (active && active !== entry.preset) {
    throw new Error(`Circuits for ${active} are loaded; reload the page to vote on this poll.`)
  }
  if (registeredPreset() === entry.preset) return
  loading ??= {
    preset: entry.preset,
    done: entry
      .load()
      .then(async ({ loadCircuits }) => setCircuits(await loadCircuits()))
      .catch((error) => {
        loading = undefined
        throw error
      }),
  }
  await loading.done
}

/** The committee key from the CRISP server, accepted only if it matches the on-chain commitment. */
async function committeeKey(e3Id: bigint, commitment: Hex): Promise<Uint8Array> {
  const server = new CrispSDK(CRISP_SERVER_URL)
  const [publicKey, params] = await Promise.all([
    server.getRoundPublicKey(e3Id),
    getRoundBfvParams({ interfoldAddress: INTERFOLD_ADDRESS, e3Id, chainId: CHAIN.id, rpcUrl: RPC_URL }),
  ])
  // Encrypting to an unverified key would let whoever served it read the ballot.
  if (!isCommitteeKeyAuthentic(publicKey, commitment, params)) {
    throw new Error("The committee key the server returned does not match the poll's on-chain commitment.")
  }
  return publicKey
}

// ---------------------------------------------------------------------------------------------------------------
// Ciphertexts this browser staged. A re-vote extends the slot's head, whose bytes only the voter (and, once an Aztec epoch
// is proven, the server) holds: keeping them here lets a voter change their vote straight away.
// ---------------------------------------------------------------------------------------------------------------

const ciphertextKey = (e3Id: bigint, hash: Hex) => `crisp-signal:ciphertext:v1:${e3Id}:${hash}`

export const ciphertexts = {
  get: (e3Id: bigint, hash: Hex): Uint8Array | undefined => {
    const stored = localStorage.getItem(ciphertextKey(e3Id, hash))
    return stored ? hexToBytes(stored as Hex) : undefined
  },
  set: (e3Id: bigint, ciphertext: Uint8Array) => {
    const hash = keccak256(ciphertext)
    try {
      localStorage.setItem(ciphertextKey(e3Id, hash), bytesToHex(ciphertext))
    } catch (error) {
      // A full storage only costs the shortcut: the server can serve the head once its epoch is proven.
      console.warn('Could not keep the ciphertext for re-votes', error)
    }
  },
}

/**
 * The entry that holds `slot`: the end of its chain of committed inputs, read from Aztec's public logs (which show an input the
 * moment its block exists), with its bytes from this browser or, failing that, from the server. A new input has to name this entry
 * as its parent or the tally drops it, so a head that cannot be resolved is an error, never an empty slot.
 */
async function resolveHead(client: CrispAztec, e3Id: bigint, slot: Address): Promise<SlotHead | undefined> {
  const logs = (await client.logs('InputCommitted', { e3Id })).filter((log) => log.slot.toLowerCase() === slot.toLowerCase())
  const index = await slotHeadIndex(
    logs.map((log) => ({ index: log.index, slot: log.slot, parentIndexPlusOne: log.parentIndexPlusOne })),
    slot,
    () => true,
  )
  if (index === undefined) return undefined
  const entry = logs.find((log) => log.index === index)!

  const local = ciphertexts.get(e3Id, entry.encryptedVoteHash)
  if (local && keccak256(local) === entry.encryptedVoteHash) return { ciphertext: local, index }

  const head = await new CrispSDK(CRISP_SERVER_URL).getPreviousCiphertext(e3Id, slot)
  if (!head || head.index !== index || keccak256(head.ciphertext) !== entry.encryptedVoteHash) {
    throw new Error(
      "This slot's latest ballot is on Aztec, but the CRISP server cannot serve it yet: it reads Aztec once an epoch is proven, " +
        'about one to two hours after the ballot. Try again later.',
    )
  }
  return head
}

// ---------------------------------------------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------------------------------------------

// Fold public inputs, in the order the Aztec contract reads them (`buildCast` of `@crisp-e3/aztec`).
const PI = { PREV_COMMITMENT: 0, CENSUS_ROOT: 4, CT_COMMITMENT: 7, COMMITTEE_KEY: 8 } as const

/** A 64-byte `r ‖ s` signature carries no recovery id, so try both parities. */
async function isSignedBy(digest: Hex, compact: Hex, signer: Address): Promise<boolean> {
  if (hexToBytes(compact).length !== 64) throw new Error('The attestation signature must be 64 bytes (r ‖ s)')
  for (const v of ['1b', '1c']) {
    const recovered = await recoverAddress({ hash: digest, signature: `${compact}${v}` })
    if (recovered.toLowerCase() === signer.toLowerCase()) return true
  }
  return false
}

type BuildCastArgs = {
  e3Id: bigint
  slot: Address
  credits: bigint
  numOptions: number
  census: Census
  committeePublicKey: Uint8Array
  committeeKeyCommitment: Hex
  availabilitySigner: Address
  program: Address
  head: SlotHead | undefined
  /** Omit for a mask. */
  vote?: { option: number; signer: Hex }
  onProgress: (progress: VoteProgress) => void
}

/**
 * `buildCast` of `@crisp-e3/aztec`, except that the slot head is the caller's (resolved from Aztec's logs, see
 * {@link resolveHead}) instead of whatever the server has indexed so far.
 */
async function buildCast(args: BuildCastArgs): Promise<CastArguments> {
  const { availabilityDigest, ballotDigest, inputId, stageInput } = await loadSdk()
  const { e3Id, slot, program } = args
  const l1ChainId = CHAIN.id
  const noun = args.vote ? 'ballot' : 'mask'

  args.onProgress({ step: 'encrypting', detail: `Encrypting the ${noun}` })
  const zero = getZeroVote(args.numOptions)
  const vote = args.vote ? zero.map((_, i) => (i === args.vote!.option ? 1 : 0)) : zero
  const inputs = {
    censusMode: 'merkle' as const,
    publicKey: args.committeePublicKey,
    slotAddress: slot,
    isMaskVote: !args.vote,
    numOptions: args.numOptions,
    vote,
    merkleLeaves: args.census.leaves,
    balance: args.credits,
  }
  // The head is a pair: its bytes and the tree index they sit at.
  const prepared = await prepareBallot(args.head ? { ...inputs, previousCiphertext: args.head.ciphertext, previousIndex: args.head.index } : inputs)

  // The digest the contract checks: the voter signs it with the slot's key. A mask carries the same digest and no signature.
  const digest = ballotDigest({ l1ChainId, program, e3Id, slot, ciphertextCommitment: prepared.ctCommitment })
  const proving = `Proving the ${noun} is well-formed`
  const options = {
    verifierTarget: 'noir-recursive' as const,
    onProgress: ({ stage, index, total }: { stage: ProofStage; index: number; total: number }) =>
      args.onProgress({ step: 'proving', detail: proving, proofStage: stage, proofIndex: index, proofTotal: total }),
  }
  args.onProgress({ step: 'proving', detail: proving })
  const result = args.vote
    ? await finishBallotProof(prepared, digest, await sign({ hash: digest, privateKey: args.vote.signer, to: 'hex' }), options)
    : await finishMaskProof(prepared, digest, options)
  if (!result.recursive) throw new Error('The fold proof carries no recursive artifacts')

  const pi = result.publicInputs.map((value) => BigInt(value))
  if (pi.length !== 9) throw new Error(`The fold proof has ${pi.length} public inputs, expected 9`)
  if (pi[PI.CENSUS_ROOT] !== args.census.root) throw new Error('The proof was made against a different census root than the one rebuilt from the logs')
  if (pi[PI.COMMITTEE_KEY] !== BigInt(args.committeeKeyCommitment)) {
    throw new Error('The committee public key the server serves does not match the key the Aztec contract stored')
  }
  if (pi[PI.CT_COMMITMENT] !== BigInt(prepared.ctCommitment)) throw new Error('The proof commits to a different ciphertext than the one prepared')

  args.onProgress({ step: 'staging', detail: `Staging the encrypted ${noun} with the CRISP server` })
  const encryptedVoteHash = keccak256(bytesToHex(result.encryptedVote))
  const attestation: InputAttestation = await stageInput(CRISP_SERVER_URL, {
    e3Id,
    slot,
    ciphertext: result.encryptedVote,
    ciphertextCommitment: prepared.ctCommitment,
    parentIndexPlusOne: result.parentIndexPlusOne,
  })

  const id = inputId({
    program,
    e3Id,
    encryptedVoteHash,
    commitment: prepared.ctCommitment,
    slot,
    parentIndexPlusOne: result.parentIndexPlusOne,
  })
  if (attestation.inputId !== id || attestation.encryptedVoteHash !== encryptedVoteHash) {
    throw new Error('The server attested a different input than the one built')
  }
  const attested = availabilityDigest({ l1ChainId, program, e3Id, inputId: id, expiresAt: attestation.expiresAt })
  if (!(await isSignedBy(attested, attestation.signature, args.availabilitySigner))) {
    throw new Error('The attestation is not signed by the availability signer')
  }

  return {
    e3Id,
    vk: result.recursive.vkFields.map((field) => BigInt(field)),
    proof: result.recursive.proofFields.map((field) => BigInt(field)),
    slot,
    ctCommitment: prepared.ctCommitment,
    encryptedVoteHash,
    parentIndexPlusOne: result.parentIndexPlusOne,
    prevCommitment: pi[PI.PREV_COMMITMENT],
    censusRoot: args.census.root,
    expiresAt: attestation.expiresAt,
    signature: attestation.signature,
    encryptedVote: result.encryptedVote,
    attestation,
  }
}

/**
 * A vote is a signed one-hot ballot for the voter's own slot. A mask is an unsigned all-zero ballot for any registered slot: the
 * circuit adds it to the slot's current ciphertext, so the slot's choice is unchanged, and on Aztec it is indistinguishable from a
 * vote or a re-vote.
 */
export type BallotKind = { kind: 'vote'; option: number } | { kind: 'mask' }

type SubmitBallotArgs = {
  e3Id: bigint
  /** The slot written: the voter's own for a vote, the masked registrant's for a mask. */
  slot: Address
  numOptions: number
  ballot: BallotKind
  onProgress: (progress: VoteProgress) => void
}

/**
 * Encrypts a ballot to the poll's committee key, proves it in the browser, has the CRISP server stage the ciphertext and attest its
 * availability, and sends `cast` to the Aztec contract from this browser's account (fees paid by the SponsoredFPC).
 *
 * Votes and masks take the same requests in the same order, so the server cannot tell them apart by the traffic.
 *
 * @returns The Aztec transaction hash.
 */
export async function submitBallot({ e3Id, slot, numOptions, ballot, onProgress }: SubmitBallotArgs): Promise<string> {
  const noun = ballot.kind === 'vote' ? 'ballot' : 'mask'
  onProgress({ step: 'connecting', detail: 'Connecting to Aztec' })
  const signer = ballot.kind === 'vote' ? slotKeys.get(e3Id) : undefined
  if (ballot.kind === 'vote') {
    if (!signer) throw new Error("This browser does not hold the key of your slot for this poll, so it cannot sign a ballot for it.")
    if (slotKeys.address(signer).toLowerCase() !== slot.toLowerCase()) throw new Error('The slot does not belong to the key this browser holds.')
  }

  const [client, deployment, server, e3] = await Promise.all([
    getClient(),
    loadDeployment(),
    loadServerConfig(),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3', args: [e3Id] }),
  ])
  const round = await client.getRound(e3Id)
  if (!round) throw new Error('The round is not open on Aztec yet.')
  const committeeKeyCommitment = await client.getCommitteeKey(e3Id)
  if (!committeeKeyCommitment) throw new Error('The committee key has not reached Aztec yet.')
  if (BigInt(committeeKeyCommitment) !== BigInt(e3.committeePublicKey)) {
    throw new Error("The committee key on Aztec is not the one Interfold published for this poll.")
  }
  if (!(await client.isSlotRegistered(e3Id, slot))) throw new Error('That slot is not registered for this poll.')

  onProgress({ step: 'encrypting', detail: 'Fetching the committee key, the census and the circuits' })
  const [census, committeePublicKey] = await Promise.all([
    client.getCensus(e3Id),
    committeeKey(e3Id, e3.committeePublicKey),
    ensureCircuits(e3.paramSet),
  ]).then(([c, k]) => [c, k] as const)
  const head = await resolveHead(client, e3Id, slot)

  const args = await buildCast({
    e3Id,
    slot,
    credits: round.credits,
    numOptions,
    census,
    committeePublicKey,
    committeeKeyCommitment,
    availabilitySigner: server.signer,
    program: deployment.program,
    head,
    vote: ballot.kind === 'vote' ? { option: ballot.option, signer: signer! } : undefined,
    onProgress,
  })

  onProgress({ step: 'sending', detail: `Proving and sending the ${noun} to Aztec: about a minute, keep this tab open` })
  const sent = await client.cast(args)
  // From here the slot's head is this ciphertext, whatever happens next.
  ciphertexts.set(e3Id, args.encryptedVote)
  invalidateLogs()
  onProgress({ step: 'done' })
  return sent.txHash
}

/** A uniform index in `[0, total)`: rejection sampling, so no registrant gets more cover than another. */
function uniformIndex(total: bigint): bigint {
  const range = 1n << 256n
  const limit = range - (range % total)
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const draw = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
    if (draw < limit) return draw % total
  }
}

/** A uniformly random registered slot of the poll, as a mask target. */
export function randomRegistrant(members: readonly Address[]): Address {
  if (members.length === 0) throw new Error('Nobody has verified for this poll yet, so there is no slot to mask.')
  return members[Number(uniformIndex(BigInt(members.length)))]
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

/** Registers this browser's slot for the poll with a ZKPassport `compressed` proof bound to this browser's Aztec account. */
export async function registerSlot(args: { e3Id: bigint; proof: CompressedProofResult }): Promise<{ slot: Address; txHash: string }> {
  const client = await getClient()
  const slot = slotKeys.address(slotKeys.getOrCreate(args.e3Id))
  const sent = await client.register({ e3Id: args.e3Id, slot, proof: args.proof })
  invalidateLogs()
  return { slot, txHash: sent.txHash }
}

// ---------------------------------------------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------------------------------------------

export type InputKind = BallotKind['kind']
export type InputReceipt = { at: number; txHash: string; slot: Address }

const receiptKey = (kind: InputKind, e3Id: bigint) => `crisp-signal:${kind}:${CHAIN.id}:${e3Id}`

/**
 * This browser's memory of the last vote and last mask it sent for a poll. Never the option chosen: only that an input was sent, so
 * the page can say "you voted" without the server or chain knowing.
 */
export const inputReceipt = {
  get: (kind: InputKind, e3Id: bigint): InputReceipt | null => {
    try {
      return JSON.parse(localStorage.getItem(receiptKey(kind, e3Id)) ?? 'null')
    } catch {
      return null
    }
  },
  set: (kind: InputKind, e3Id: bigint, receipt: Omit<InputReceipt, 'at'>) =>
    localStorage.setItem(receiptKey(kind, e3Id), JSON.stringify({ at: Date.now(), ...receipt })),
}
