import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { BOARD_ADDRESS, INTERFOLD_ADDRESS } from '../config'
import { crispProgramAbi, crispSignalAbi, E3Stage, interfoldAbi, passportRegistryAbi } from './abi'
import { publicClient } from './wagmi'

export enum NationalityRule {
  Any,
  Allow,
  Deny,
}

export type Policy = {
  minAge: number
  nationalityRule: NationalityRule
  countries: string[]
  faceMatch: boolean
  devMode: boolean
}

export type Phase = 'preparing' | 'scheduled' | 'open' | 'tallying' | 'decrypting' | 'final' | 'failed' | 'stalled'

export type Poll = {
  id: bigint
  e3Id: bigint
  registry: Address
  creator: Address
  createdAt: number
  metadataCid: string
  program: Address
  stage: E3Stage
  /** Unix seconds. */
  opensAt: number
  /** Unix seconds: CRISP refuses new ballots from here on. */
  closesAt: number
  numOptions: number
  ballots: number
  registrants: number
  policy: Policy
  /** One total per option, once the committee has decrypted the tally. */
  tally?: bigint[]
}

type BoardPoll = {
  e3Id: bigint
  registry: Address
  creator: Address
  feeToken: Address
  createdAt: bigint
  metadataCid: string
}

export function phaseOf(poll: Pick<Poll, 'stage' | 'opensAt' | 'closesAt'>, now = Date.now() / 1000): Phase {
  switch (poll.stage) {
    case E3Stage.Failed:
      return 'failed'
    case E3Stage.Complete:
      return 'final'
    case E3Stage.CiphertextReady:
      return 'decrypting'
    case E3Stage.KeyPublished:
      if (now < poll.opensAt) return 'scheduled'
      return now < poll.closesAt ? 'open' : 'tallying'
    default:
      // The committee never published a key before the window closed: no ballot can be cast.
      return now < poll.closesAt ? 'preparing' : 'stalled'
  }
}

/** Every read is typed by its ABI; the client batches concurrent reads into multicalls. */
async function hydrateOne(id: bigint, p: BoardPoll): Promise<Poll> {
  const [stage, e3, policy, registrants] = await Promise.all([
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3Stage', args: [p.e3Id] }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getE3', args: [p.e3Id] }),
    publicClient.readContract({ address: p.registry, abi: passportRegistryAbi, functionName: 'policy' }),
    publicClient.readContract({ address: p.registry, abi: passportRegistryAbi, functionName: 'totalRegistrants' }),
  ])
  const program = e3.e3Program
  const [round, deadline, tally] = await Promise.all([
    publicClient.readContract({ address: program, abi: crispProgramAbi, functionName: 'getRoundData', args: [p.e3Id] }),
    publicClient.readContract({ address: program, abi: crispProgramAbi, functionName: 'inputCommitmentDeadline', args: [p.e3Id] }),
    stage === E3Stage.Complete
      ? publicClient.readContract({ address: program, abi: crispProgramAbi, functionName: 'decodeTally', args: [p.e3Id] })
      : undefined,
  ])
  return {
    id,
    e3Id: p.e3Id,
    registry: p.registry,
    creator: p.creator,
    createdAt: Number(p.createdAt),
    metadataCid: p.metadataCid,
    program,
    stage,
    opensAt: Number(e3.inputWindow[0]),
    closesAt: Number(deadline),
    numOptions: Number(round[2]),
    ballots: Number(round[5]),
    registrants: Number(registrants),
    policy: {
      minAge: policy.minAge,
      nationalityRule: policy.nationalityRule,
      countries: [...policy.countries],
      faceMatch: policy.faceMatch,
      devMode: policy.devMode,
    },
    tally: tally ? [...tally] : undefined,
  }
}

export async function loadPolls(limit = 50): Promise<Poll[]> {
  const count = await publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAbi, functionName: 'pollCount' })
  const [ids, page] = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAbi,
    functionName: 'getPolls',
    args: [count, BigInt(limit)],
  })
  return Promise.all(page.map((p, i) => hydrateOne(ids[i], p)))
}

export async function loadPoll(id: bigint): Promise<Poll> {
  const poll = await publicClient.readContract({
    address: BOARD_ADDRESS,
    abi: crispSignalAbi,
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
