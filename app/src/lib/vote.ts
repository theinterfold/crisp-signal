import type { ProofStage, SlotHead } from '@crisp-e3/sdk'
import type { CastArguments, Census, CompressedProofResult, CrispAztec, InputAttestation, ZKPassportProofParams } from '@crisp-e3/aztec'
import { bytesToHex, hexToBytes, keccak256, recoverAddress, type Address, type Hex } from 'viem'
import { sign } from 'viem/accounts'
import { CHAIN, CRISP_SERVER_URL, INTERFOLD_ADDRESS, RPC_URL } from '../config'
import { interfoldAbi } from './abi'
import { getClient, invalidateLogs, l1Registration, loadCrispSdk, loadDeployment, loadRound, loadSdk, loadServerConfig, slotKeys } from './aztec'
import { ensureCircuits } from './circuits'
import { publicClient } from './chain'
import { warmUp } from './warmup'

export type VoteStep = 'connecting' | 'encrypting' | 'proving' | 'pass' | 'staging' | 'sending' | 'done'

export type VoteProgress = { step: VoteStep; detail?: string; proofStage?: ProofStage; proofIndex?: number; proofTotal?: number }

/** The committee key from the CRISP server, accepted only if it matches the on-chain commitment. */
async function committeeKey(e3Id: bigint, commitment: Hex): Promise<Uint8Array> {
  const { CrispSDK, getRoundBfvParams, isCommitteeKeyAuthentic } = await loadCrispSdk()
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
  const { CrispSDK, slotHeadIndex } = await loadCrispSdk()
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
// Staging passes: each slot key may stage `staging_max_requests` ciphertexts a round (votes and masks together), each under a
// counter the server accepts once, so the counter is kept here and consumed before staging: a refused or lost staging used its.
// ---------------------------------------------------------------------------------------------------------------

const stagingCounterKey = (e3Id: bigint) => `crisp-signal:staging-counter:v1:${e3Id}`

const outOfPasses = (max: number) => new Error(`This slot has used all ${max} ballots and masks the CRISP server accepts from one voter in a poll.`)

const stagingCounter = {
  /** Passes this browser has taken for the poll; also what the server counts at most. */
  used: (e3Id: bigint): number => {
    const used = Number(localStorage.getItem(stagingCounterKey(e3Id)) ?? 0)
    if (!Number.isInteger(used) || used < 0) throw new Error('The staging counter in this browser is corrupt.')
    return used
  },
  /** Takes the next counter. */
  next: (e3Id: bigint, maxRequests: number): number => {
    const used = stagingCounter.used(e3Id)
    if (used >= maxRequests) throw outOfPasses(maxRequests)
    localStorage.setItem(stagingCounterKey(e3Id), String(used + 1))
    return used
  },
}

// ---------------------------------------------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------------------------------------------

/**
 * The server's answer (400) to a staging pass whose census root it has not seen: `UNKNOWN_ROOT` of the server's
 * `staging_pass.rs`. It re-reads the remote chain at most every `ROOT_REFRESH_INTERVAL` (5 s) and a voter who registered a moment ago
 * is told to retry, so one retry a little later, with a fresh pass, is what it asks for.
 */
const UNKNOWN_ROOT = 'The staging pass names a census root this round has not had'
const UNKNOWN_ROOT_RETRY_MS = 6_000
const isUnknownCensusRoot = (error: unknown) => error instanceof Error && error.message.includes('(400)') && error.message.includes(UNKNOWN_ROOT)

// Public inputs of the ballot (crisp) proof, in the order the circuit declares them (`buildCast` of `@crisp-e3/aztec`).
const PI = { PREV_COMMITMENT: 0, CENSUS_ROOT: 4, CT_COMMITMENT: 7 } as const

const toBigints = (fields: string[]): bigint[] => fields.map((field) => BigInt(field))

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
  availabilitySigner: Address
  program: Address
  head: SlotHead | undefined
  /** The voter's OWN slot key signs the staging pass, for a vote and a mask alike (a mask names another slot, `slot`). */
  staging: { signer: Hex; maxRequests: number; nextCounter: () => number }
  /** Omit for a mask. */
  vote?: { option: number; signer: Hex }
  onProgress: (progress: VoteProgress) => void
}

/**
 * `buildCast` of `@crisp-e3/aztec`, except that the slot head is the caller's (resolved from Aztec's logs, see
 * {@link resolveHead}) instead of whatever the server has indexed so far.
 */
async function buildCast(args: BuildCastArgs): Promise<CastArguments> {
  const [{ availabilityDigest, ballotDigest, buildStagingPass, destroyStagingPassProver, inputId, stageInput }, crisp] = await Promise.all([
    loadSdk(),
    loadCrispSdk(),
  ])
  const { finishBallotBaseProofs, finishMaskBaseProofs, getZeroVote, prepareBallot } = crisp
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
  // No aggregation: the Aztec contract verifies the three base proofs (the two encryption proofs and the ballot proof) itself, so
  // the proofs stay in this browser, as private arguments of `cast`.
  const options = {
    onProgress: ({ stage, index, total }: { stage: ProofStage; index: number; total: number }) =>
      args.onProgress({ step: 'proving', detail: proving, proofStage: stage, proofIndex: index, proofTotal: total }),
  }
  args.onProgress({ step: 'proving', detail: proving })
  const result = args.vote
    ? await finishBallotBaseProofs(prepared, digest, await sign({ hash: digest, privateKey: args.vote.signer, to: 'hex' }), options)
    : await finishMaskBaseProofs(prepared, digest, options)

  const pi = result.crisp.publicInputs.map((value) => BigInt(value))
  if (pi.length !== 10) throw new Error(`The ballot proof has ${pi.length} public inputs, expected 10`)
  if (result.ct0.publicInputs.length !== 4 || result.ct1.publicInputs.length !== 3) {
    throw new Error('The encryption proofs have an unexpected number of public inputs')
  }
  if (pi[PI.CENSUS_ROOT] !== args.census.root) throw new Error('The proof was made against a different census root than the one rebuilt from the logs')
  if (pi[PI.CT_COMMITMENT] !== BigInt(prepared.ctCommitment)) throw new Error('The proof commits to a different ciphertext than the one prepared')

  const encryptedVoteHash = keccak256(bytesToHex(result.encryptedVote))
  const staged = {
    e3Id,
    slot,
    ciphertext: result.encryptedVote,
    ciphertextCommitment: prepared.ctCommitment,
    parentIndexPlusOne: result.parentIndexPlusOne,
  }
  // The pass proves, without saying which, that the sender holds the key of SOME registered slot, so the server's storage cannot be
  // filled by outsiders; its tag limits each slot key to `maxRequests` stagings a round, votes and masks alike. Each pass takes the
  // next counter, and a pass the server refused has used its own.
  const stagePass = async (): Promise<InputAttestation> => {
    args.onProgress({ step: 'pass', detail: `Proving you hold a registered slot, without saying which (a staging pass for the ${noun})` })
    let stagingPass
    try {
      stagingPass = await buildStagingPass({
        signer: (hash) => sign({ hash, privateKey: args.staging.signer, to: 'hex' }),
        census: args.census,
        credits: args.credits,
        request: { l1ChainId, program, ...staged },
        maxRequests: args.staging.maxRequests,
        counter: args.staging.nextCounter(),
      })
    } finally {
      // Frees the pass prover's WASM instance and its SRS; a later pass makes a new one.
      await destroyStagingPassProver()
    }
    args.onProgress({ step: 'staging', detail: `Staging the encrypted ${noun} with the CRISP server` })
    return stageInput(CRISP_SERVER_URL, { ...staged, stagingPass })
  }
  let attestation: InputAttestation
  try {
    attestation = await stagePass()
  } catch (error) {
    if (!isUnknownCensusRoot(error)) throw error
    // The server has not seen the newest registrations of the census yet: it re-reads the chain at most every few seconds.
    args.onProgress({ step: 'staging', detail: 'Waiting for the server to see the latest registrations…' })
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_ROOT_RETRY_MS))
    attestation = await stagePass()
  }

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
    ct0Vk: toBigints(result.ct0.vkFields),
    ct0Proof: toBigints(result.ct0.proofFields),
    ct0PublicInputs: toBigints(result.ct0.publicInputs),
    ct1Vk: toBigints(result.ct1.vkFields),
    ct1Proof: toBigints(result.ct1.proofFields),
    ct1PublicInputs: toBigints(result.ct1.publicInputs),
    crispVk: toBigints(result.crisp.vkFields),
    crispProof: toBigints(result.crisp.proofFields),
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
  // Votes and masks alike are staged with this browser's own slot key, so only registered voters can add either.
  const ownKey = slotKeys.get(e3Id)
  if (!ownKey) throw new Error(`This browser does not hold the key of a slot registered for this poll, so it cannot ${noun === 'ballot' ? 'sign a ballot' : 'add a mask'}.`)
  if (ballot.kind === 'vote' && slotKeys.address(ownKey).toLowerCase() !== slot.toLowerCase()) {
    throw new Error('The slot does not belong to the key this browser holds.')
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
  if (!(await client.isSlotRegistered(e3Id, slotKeys.address(ownKey)))) throw new Error('This browser\'s slot is not registered for this poll yet.')
  // Counters are taken one per pass, as each is built (`staging.nextCounter`), so a voter out of passes learns it here, not mid-proof.
  if (stagingCounter.used(e3Id) >= server.staging_max_requests) throw outOfPasses(server.staging_max_requests)

  onProgress({ step: 'encrypting', detail: 'Fetching the committee key, the census and the circuits' })
  // Normally done by now: the poll page starts it when it opens. This waits for whatever is left, and never runs it twice.
  await warmUp(e3.paramSet)
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
    availabilitySigner: server.signer,
    program: deployment.program,
    head,
    staging: { signer: ownKey, maxRequests: server.staging_max_requests, nextCounter: () => stagingCounter.next(e3Id, server.staging_max_requests) },
    vote: ballot.kind === 'vote' ? { option: ballot.option, signer: ownKey } : undefined,
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

/**
 * Registers this browser's slot on an L1-path poll: sends the ZKPassport `compressed-evm` proof, as `ZKPassportRegistrar.register`
 * calldata, to the CRISP server, which simulates it and submits it from its own Ethereum account, so the voter needs no wallet and
 * no gas. The proof binds the slot and the chain, so the server (or anyone) cannot redirect it. The registration is then on
 * Ethereum; {@link awaitL1Registration} follows it to the Aztec census.
 */
export async function registerSlotOnL1(args: {
  e3Id: bigint
  countries: string[]
  params: ZKPassportProofParams
}): Promise<{ slot: Address; txHash: Hex }> {
  const { registerOnL1Calldata, relayRegistrationOnL1 } = await loadSdk()
  const slot = slotKeys.address(slotKeys.getOrCreate(args.e3Id))
  const calldata = registerOnL1Calldata({ e3Id: args.e3Id, slot, params: args.params, countries: args.countries })
  const { txHash } = await relayRegistrationOnL1(CRISP_SERVER_URL, calldata)
  l1Registration.set(args.e3Id, txHash)
  return { slot, txHash }
}

export type L1RegistrationStep = 'confirming' | 'aztec'

const AZTEC_POLL_MS = 15_000

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Follows an L1 registration: waits for the Ethereum transaction, then for the keeper to relay the slot's Inbox message into the
 * Aztec census (`MemberRegistered` in the contract's public logs), which is when the slot can vote.
 */
export async function awaitL1Registration(args: {
  e3Id: bigint
  slot: Address
  txHash: Hex
  onStep: (step: L1RegistrationStep) => void
  signal: AbortSignal
}): Promise<void> {
  const { e3Id, slot, txHash, onStep, signal } = args
  onStep('confirming')
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    l1Registration.clear(e3Id)
    throw new Error('The registration transaction reverted on Ethereum.')
  }

  onStep('aztec')
  for (;;) {
    invalidateLogs()
    const round = await loadRound(e3Id).catch((error: unknown) => {
      console.warn('Could not read the census from Aztec', error)
      return undefined
    })
    if (round?.members.some((member) => member.toLowerCase() === slot.toLowerCase())) {
      l1Registration.clear(e3Id)
      return
    }
    await sleep(AZTEC_POLL_MS, signal)
  }
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
