import {
  CrispSDK,
  encodeSolidityProof,
  getRoundBfvParams,
  isCommitteeKeyAuthentic,
  registeredPreset,
  setCircuits,
  type BroadcastVoteResponse,
  type CircuitBundle,
  type CircuitPreset,
  type ProofStage,
} from '@crisp-e3/sdk'
import type { Address, Hex } from 'viem'
import { CHAIN, CRISP_SERVER_URL, INTERFOLD_ADDRESS, RPC_URL } from '../config'
import { crispProgramAbi, interfoldAbi, passportRegistryAbi } from './abi'
import { publicClient } from './wagmi'

export const crisp = new CrispSDK(CRISP_SERVER_URL, RPC_URL)

export type VoteStep = 'encrypting' | 'signing' | 'proving' | 'submitting' | 'confirming' | 'done'

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
  const [publicKey, params] = await Promise.all([
    crisp.getRoundPublicKey(e3Id),
    getRoundBfvParams({ interfoldAddress: INTERFOLD_ADDRESS, e3Id, chainId: CHAIN.id, rpcUrl: RPC_URL }),
  ])
  // Encrypting to an unverified key would let whoever served it read the ballot.
  if (!isCommitteeKeyAuthentic(publicKey, commitment, params)) {
    throw new Error("The committee key the server returned does not match the poll's on-chain commitment.")
  }
  return publicKey
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A vote is a signed one-hot ballot for the voter's own slot. A mask is an unsigned all-zero ballot
 * for any registered slot: the circuit adds it to the slot's current ciphertext, so the slot's
 * choice is unchanged, and on-chain it is indistinguishable from a vote or a re-vote.
 */
export type BallotKind =
  | { kind: 'vote'; option: number; signBallot: (args: { program: Address; ctCommitment: Hex }) => Promise<Hex> }
  | { kind: 'mask' }

type SubmitBallotArgs = {
  e3Id: bigint
  /** The slot written: the voter's own for a vote, the masked registrant's for a mask. */
  slot: Address
  numOptions: number
  ballot: BallotKind
  /** Sends the server-attested payload from the connected wallet, when the relay hands it back. */
  publishFromWallet: (args: { program: Address; payload: Hex }) => Promise<Hex>
  onProgress: (progress: VoteProgress) => void
}

/**
 * Encrypts a ballot to the poll's committee key, binds it with the EIP-712 digest (signed for a
 * vote), proves it in the browser, and stages it with the CRISP server, which attests availability
 * and either relays `publishInput` or hands the payload back for the wallet to send.
 *
 * Votes and masks take the same requests in the same order, so the server cannot tell them apart
 * by the traffic.
 *
 * @returns The `publishInput` transaction, or null when the server sent it without reporting one.
 */
export async function submitBallot({ e3Id, slot, numOptions, ballot, publishFromWallet, onProgress }: SubmitBallotArgs) {
  const noun = ballot.kind === 'vote' ? 'ballot' : 'mask'
  onProgress({ step: 'encrypting', detail: 'Fetching the committee key and circuits' })
  const e3 = await publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3', args: [e3Id] })
  const program = e3.e3Program
  const [publicKey, votingPower] = await Promise.all([
    committeeKey(e3Id, e3.committeePublicKey),
    // The exact value `publishInput` hands the circuit, read from the contract that verifies it.
    publicClient.readContract({ address: program, abi: crispProgramAbi, functionName: 'votingPowerOf', args: [e3Id, slot] }),
    ensureCircuits(e3.paramSet),
  ])

  const vote = Array.from({ length: numOptions }, (_, i) => (ballot.kind === 'vote' && i === ballot.option ? 1 : 0))
  onProgress({ step: 'encrypting', detail: `Encrypting the ${noun}` })
  const prepared = await crisp.prepareBallot({
    e3Id,
    programAddress: program,
    chainId: CHAIN.id,
    publicKey,
    slotAddress: slot,
    isMaskVote: ballot.kind === 'mask',
    numOptions,
    vote,
    censusMode: 'onchain',
    votingPower,
  })

  // A mask carries the real digest too: `publishInput` computes one for every input.
  const digest = await publicClient.readContract({
    address: program,
    abi: crispProgramAbi,
    functionName: 'ballotDigest',
    args: [e3Id, slot, prepared.ctCommitment],
  })

  let signature: Hex | undefined
  if (ballot.kind === 'vote') {
    onProgress({ step: 'signing', detail: 'Sign the ballot in your wallet' })
    signature = await ballot.signBallot({ program, ctCommitment: prepared.ctCommitment })
  }

  const proving = `Proving the ${noun} is well-formed`
  onProgress({ step: 'proving', detail: proving })
  const proof = await crisp.finishBallot(prepared, digest, signature, {
    onProgress: ({ stage, index, total }) =>
      onProgress({ step: 'proving', detail: proving, proofStage: stage, proofIndex: index, proofTotal: total }),
  })

  onProgress({ step: 'submitting', detail: `Staging the encrypted ${noun} with the CRISP server` })
  let view: BroadcastVoteResponse = await crisp.broadcastVote({ e3Id, encodedProof: encodeSolidityProof(proof) })

  // The server's worker decides who sends the commitment; it can take a while under load.
  const deadline = Date.now() + 10 * 60_000
  while (view.status === 'pending_commitment' && !view.tx_hash) {
    if (!view.job_id) throw new Error(view.message ?? `The CRISP server queued the ${noun} without a job id.`)
    if (Date.now() > deadline) throw new Error(`The CRISP server has not committed the ${noun} after 10 minutes.`)
    onProgress({ step: 'submitting', detail: `Waiting for the relay to commit the ${noun}` })
    await sleep(5_000)
    view = await crisp.getVoteAvailability(view.job_id)
  }

  if (view.status === 'failed_broadcast') throw new Error(view.message ?? `The CRISP server refused the ${noun}.`)

  let txHash = (view.tx_hash as Hex | null) ?? null
  if (!txHash && view.status === 'ready_for_commitment') {
    if (!view.encoded_proof) throw new Error('The CRISP server returned no attested payload to send.')
    onProgress({ step: 'submitting', detail: `Confirm the ${noun} transaction in your wallet` })
    // Sent verbatim: only the server can produce the availability attestation inside it.
    txHash = await publishFromWallet({ program, payload: view.encoded_proof as Hex })
  }

  if (txHash) {
    onProgress({ step: 'confirming', detail: `Waiting for the ${noun} to be mined` })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') throw new Error(`The ${noun} transaction reverted.`)
  }
  onProgress({ step: 'done' })
  return txHash
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

/**
 * A uniformly random verified voter of the poll, as a mask target. Read live from the registry,
 * because voters keep registering during the voting window.
 */
export async function randomRegistrant(registry: Address): Promise<Address> {
  const total = await publicClient.readContract({ address: registry, abi: passportRegistryAbi, functionName: 'totalRegistrants' })
  if (total === 0n) throw new Error('Nobody has verified for this poll yet, so there is no slot to mask.')
  return publicClient.readContract({ address: registry, abi: passportRegistryAbi, functionName: 'registrantAt', args: [uniformIndex(total)] })
}

export type InputKind = BallotKind['kind']
export type InputReceipt = { at: number; txHash: Hex | null; slot: Address }

const receiptKey = (kind: InputKind, e3Id: bigint, account: Address) =>
  `crisp-signal:${kind}:${CHAIN.id}:${e3Id}:${account.toLowerCase()}`

/**
 * This browser's memory of the account's last vote and last mask. Never the option chosen: only
 * that an input was sent, so the page can say "you voted" without the server or chain knowing.
 */
export const inputReceipt = {
  get: (kind: InputKind, e3Id: bigint, account: Address): InputReceipt | null => {
    try {
      return JSON.parse(localStorage.getItem(receiptKey(kind, e3Id, account)) ?? 'null')
    } catch {
      return null
    }
  },
  set: (kind: InputKind, e3Id: bigint, account: Address, receipt: Omit<InputReceipt, 'at'>) =>
    localStorage.setItem(receiptKey(kind, e3Id, account), JSON.stringify({ at: Date.now(), ...receipt })),
}
