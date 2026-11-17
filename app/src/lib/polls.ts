import { useQuery } from '@tanstack/react-query'
import { decodeAbiParameters, type Address } from 'viem'
import { BOARD_ADDRESS, INTERFOLD_ADDRESS } from '../config'
import { crispAztecProgramAbi, crispSignalAztecAbi, E3Stage, interfoldAbi } from './abi'
import { loadRound } from './aztec'
import { publicClient } from './wagmi'

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
}

export type Poll = {
  id: bigint
  e3Id: bigint
  creator: Address
  createdAt: number
  metadataCid: string
  program: Address
  stage: E3Stage
  /** Unix seconds. */
  opensAt: number
  /** Unix seconds: Aztec refuses new ballots from here on. */
  closesAt: number
  numOptions: number
  /** Minimum age voters prove; 0 for none. */
  minAge: number
  /** ZKPassport mock documents are accepted (testing only). */
  allowMockDocuments: boolean
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

/** Every read is typed by its ABI; the client batches concurrent reads into multicalls. */
async function hydrateOne(id: bigint, p: BoardPoll): Promise<Poll> {
  const [stage, e3] = await Promise.all([
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3Stage', args: [p.e3Id] }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3', args: [p.e3Id] }),
  ])
  const program = e3.e3Program
  const [numOptions, , minAge, allowMockDocuments] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }],
    e3.customParams,
  )
  const [round, tally, aztec] = await Promise.all([
    publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'getRound', args: [p.e3Id] }),
    stage === E3Stage.Complete
      ? publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'decodeTally', args: [p.e3Id] })
      : undefined,
    // The poll is still readable from Ethereum alone when the Aztec node is down.
    loadRound(p.e3Id)
      .then(({ opened, keyPublished, closed, members, inputs }): AztecStatus => ({ opened, keyPublished, closed, members, inputs }))
      .catch((error: unknown) => {
        console.warn('Could not read the poll from Aztec', error)
        return undefined
      }),
  ])
  return {
    id,
    e3Id: p.e3Id,
    creator: p.creator,
    createdAt: Number(p.createdAt),
    metadataCid: p.metadataCid,
    program,
    stage,
    opensAt: Number(e3.inputWindow[0]),
    closesAt: Number(e3.inputWindow[1]),
    numOptions: Number(numOptions),
    minAge: Number(minAge),
    allowMockDocuments,
    rootSubmitted: round.rootSubmitted,
    aztec,
    tally: tally ? [...tally] : undefined,
  }
}

export async function loadPolls(limit = 50): Promise<Poll[]> {
  const count = await publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'pollCount' })
  const [ids, page] = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAztecAbi,
    functionName: 'getPolls',
    args: [count, BigInt(limit)],
  })
  return Promise.all(page.map((p, i) => hydrateOne(ids[i], p)))
}

export async function loadPoll(id: bigint): Promise<Poll> {
  const poll = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAztecAbi,
    functionName: 'getPoll',
    args: [id],
  })
  return hydrateOne(id, poll)
}

export const usePolls = () => useQuery({ queryKey: ['polls'], queryFn: () => loadPolls(), refetchInterval: 30_000 })

export const usePoll = (id: bigint | undefined) =>
  useQuery({
    queryKey: ['poll', id?.toString()],
    queryFn: () => loadPoll(id!),
    enabled: id !== undefined,
    refetchInterval: 15_000,
  })
