import { useQuery } from '@tanstack/react-query'
import { decodeAbiParameters, type Address } from 'viem'
import { BOARD_ADDRESS, INTERFOLD_ADDRESS } from '../config'
import { crispAztecProgramAbi, crispSignalAztecAbi, E3Stage, interfoldAbi } from './abi'
import { loadPassportSdk, loadRound, type RoundTxs } from './aztec'
import { publicClient } from './chain'

/** ZKPassport nationality rule of a poll: any nationality, only the listed countries, or all but the listed countries. */
export const NationalityMode = { None: 0, In: 1, Out: 2 } as const
export type NationalityMode = (typeof NationalityMode)[keyof typeof NationalityMode]

/**
 * A poll's eligibility rules: the E3's custom parameters, which are what the CRISP program validated and announced in
 * its `RoundRules` event, and what the Aztec contract enforces.
 */
export type PollRules = {
  /** Minimum age voters prove; 0 for none. */
  minAge: number
  /** ZKPassport mock documents are accepted (testing only). */
  allowMockDocuments: boolean
  nationalityMode: NationalityMode
  /** ICAO alpha-3 codes, in the order the rule was committed to. */
  countries: string[]
  /** With a nationality rule: ZKPassport's commitment to `countries`, which the app recomputes. Otherwise 0. */
  nationalityCommitment: bigint
}

/** `abi.encode(numOptions, credits, minAge, allowMockDocuments, nationalityMode, countries, nationalityCommitment)`. */
export function decodeRules(customParams: `0x${string}`): { numOptions: number; rules: PollRules } {
  const [numOptions, , minAge, allowMockDocuments, nationalityMode, countries, nationalityCommitment] = decodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
      { type: 'uint8' },
      { type: 'string[]' },
      { type: 'uint256' },
    ],
    customParams,
  )
  if (nationalityMode > NationalityMode.Out) throw new Error(`Unknown nationality mode ${nationalityMode}.`)
  return {
    numOptions: Number(numOptions),
    rules: {
      minAge: Number(minAge),
      allowMockDocuments,
      nationalityMode: nationalityMode as NationalityMode,
      countries: [...countries],
      nationalityCommitment,
    },
  }
}

/**
 * Whether a poll's nationality rule is what it says. The contract verifies proofs against a ZKPassport commitment to the country
 * list, which Ethereum cannot recompute: a creator could name a list and commit to another. So the app recomputes the commitment
 * from the announced list and refuses a poll that does not match.
 * (A wrong commitment can only make the poll unregistrable, but the page should say so before a voter proves anything.)
 */
export async function checkRules(rules: PollRules): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (rules.nationalityMode === NationalityMode.None) {
    return rules.nationalityCommitment === 0n
      ? { ok: true }
      : { ok: false, reason: 'The poll carries a nationality commitment it does not use.' }
  }
  const { nationalityCommitment } = await loadPassportSdk()
  const expected = await nationalityCommitment(rules.nationalityMode, rules.countries)
  return expected === rules.nationalityCommitment
    ? { ok: true }
    : { ok: false, reason: "The poll's nationality commitment does not match its country list, so ZKPassport proofs for this list cannot be registered." }
}

export type Phase = 'preparing' | 'scheduled' | 'open' | 'tallying' | 'decrypting' | 'final' | 'failed' | 'stalled'

/** What Aztec's public logs say about a poll's round. Undefined on a poll while the node cannot be read. */
export type AztecStatus = {
  /** The Inbox ROUND message was consumed: the round exists on Aztec. */
  opened: boolean
  /** The committee key reached Aztec: ballots can be cast. */
  keyPublished: boolean
  /** `close_round` ran: the input root is on its way to Ethereum. */
  closed: boolean
  /** Census members, in registration order: the slot addresses registered with ZKPassport proofs. */
  members: Address[]
  /** Inputs committed on Aztec: votes, re-votes and masks. */
  inputs: number
  /** The Aztec transactions of the round's lifecycle logs, for explorer links. */
  txs: RoundTxs
}

export type Poll = {
  id: bigint
  e3Id: bigint
  creator: Address
  createdAt: number
  metadataCid: string
  program: Address
  /** The BFV parameter set, which picks the circuits ballots are proved with. */
  paramSet: number
  stage: E3Stage
  /** Unix seconds. */
  opensAt: number
  /** Unix seconds: Aztec refuses new ballots from here on. */
  closesAt: number
  numOptions: number
  rules: PollRules
  /** The input root reached Ethereum (after the Aztec epoch proof): compute can start. */
  rootSubmitted: boolean
  aztec?: AztecStatus
  /** One total per option, once the committee has decrypted the tally. */
  tally?: bigint[]
}

type BoardPoll = {
  e3Id: bigint
  creator: Address
  feeToken: Address
  createdAt: bigint
  metadataCid: string
}

export function phaseOf(poll: Pick<Poll, 'stage' | 'opensAt' | 'closesAt' | 'aztec'>, now = Date.now() / 1000): Phase {
  switch (poll.stage) {
    case E3Stage.Failed:
      return 'failed'
    case E3Stage.Complete:
      return 'final'
    case E3Stage.CiphertextReady:
      return 'decrypting'
    case E3Stage.KeyPublished:
      if (now < poll.opensAt) return 'scheduled'
      if (now >= poll.closesAt) return 'tallying'
      // Ballots need the committee key on Aztec too, which a keeper relays after Interfold publishes it.
      return poll.aztec && !poll.aztec.keyPublished ? 'preparing' : 'open'
    default:
      // The committee never published a key before the window closed: no ballot can be cast.
      return now < poll.closesAt ? 'preparing' : 'stalled'
  }
}

/** The poll is still readable from Ethereum alone when the Aztec node is down. */
async function loadAztecStatus(e3Id: bigint): Promise<AztecStatus | undefined> {
  try {
    const { opened, keyPublished, closed, members, inputs, txs } = await loadRound(e3Id)
    return { opened, keyPublished, closed, members, inputs, txs }
  } catch (error) {
    console.warn('Could not read the poll from Aztec', error)
    return undefined
  }
}

/** Every read is typed by its ABI; the client batches concurrent reads into multicalls. */
async function hydrateOne(id: bigint, p: BoardPoll, withAztec: boolean): Promise<Poll> {
  const [stage, e3] = await Promise.all([
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3Stage', args: [p.e3Id] }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3', args: [p.e3Id] }),
  ])
  const program = e3.e3Program
  const { numOptions, rules } = decodeRules(e3.customParams)
  const [round, tally, aztec] = await Promise.all([
    publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'getRound', args: [p.e3Id] }),
    stage === E3Stage.Complete
      ? publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'decodeTally', args: [p.e3Id] })
      : undefined,
    withAztec ? loadAztecStatus(p.e3Id) : undefined,
  ])
  return {
    id,
    e3Id: p.e3Id,
    creator: p.creator,
    createdAt: Number(p.createdAt),
    metadataCid: p.metadataCid,
    program,
    paramSet: e3.paramSet,
    stage,
    opensAt: Number(e3.inputWindow[0]),
    closesAt: Number(e3.inputWindow[1]),
    numOptions,
    rules,
    rootSubmitted: round.rootSubmitted,
    aztec,
    tally: tally ? [...tally] : undefined,
  }
}

/** The list reads Ethereum only, so it loads without the Aztec stack: a poll's Aztec status is read on its own page. */
export async function loadPolls(limit = 50): Promise<Poll[]> {
  const count = await publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'pollCount' })
  const [ids, page] = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAztecAbi,
    functionName: 'getPolls',
    args: [count, BigInt(limit)],
  })
  return Promise.all(page.map((p, i) => hydrateOne(ids[i], p, false)))
}

export async function loadPoll(id: bigint): Promise<Poll> {
  const poll = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAztecAbi,
    functionName: 'getPoll',
    args: [id],
  })
  return hydrateOne(id, poll, true)
}

/** The check of {@link checkRules}, once per poll; unavailable while the Aztec SDK cannot load. */
export const useRulesCheck = (poll: Pick<Poll, 'e3Id' | 'rules'>) =>
  useQuery({ queryKey: ['rules-check', poll.e3Id.toString()], queryFn: () => checkRules(poll.rules), staleTime: Infinity })

export const usePolls = () => useQuery({ queryKey: ['polls'], queryFn: () => loadPolls(), refetchInterval: 30_000 })

export const usePoll = (id: bigint | undefined) =>
  useQuery({
    queryKey: ['poll', id?.toString()],
    queryFn: () => loadPoll(id!),
    enabled: id !== undefined,
    refetchInterval: 15_000,
  })
