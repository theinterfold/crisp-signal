import { useQuery } from '@tanstack/react-query'
import { getAbiItem, type Address, type Hex } from 'viem'
import { AZTEC_EXPLORER_URL, BOARD_ADDRESS, CHAIN } from '../config'
import { crispAztecProgramAbi, crispSignalAztecAbi } from './abi'
import { publicClient } from './chain'

/** Where a transaction or contract is shown: Etherscan for Sepolia, Aztec-Scan (configurable) for the Aztec testnet. */
export type ExplorerTarget =
  | { chain: 'l1'; kind: 'tx' | 'address'; id: string }
  | { chain: 'aztec'; kind: 'tx' | 'contract'; id: string }

const L1_EXPLORER_URL = CHAIN.blockExplorers.default.url

export function explorerUrl(target: ExplorerTarget): string {
  if (target.chain === 'l1') return `${L1_EXPLORER_URL}/${target.kind}/${target.id}`
  return target.kind === 'tx' ? `${AZTEC_EXPLORER_URL}/tx-effects/${target.id}` : `${AZTEC_EXPLORER_URL}/contracts/instances/${target.id}`
}

const pollCreated = getAbiItem({ abi: crispSignalAztecAbi, name: 'PollCreated' })

/** Sepolia's slot time: the first guess of the search below, which it then corrects from the blocks it reads. */
const SLOT_SECONDS = 12n

/**
 * The block of Ethereum with exactly this timestamp (or, with `orAfter`, the first block from it on), found by interpolating between the closest blocks known on each side (with a
 * bisection every third step, so skewed data cannot stall it). Block timestamps are strictly increasing, so there is at most one.
 */
async function blockAtTimestamp(timestamp: bigint, orAfter = false): Promise<bigint | undefined> {
  let [hi, lo] = await Promise.all([publicClient.getBlock(), publicClient.getBlock({ blockNumber: 0n })])
  if (timestamp > hi.timestamp || timestamp < lo.timestamp) return undefined
  if (timestamp === hi.timestamp) return hi.number
  for (let step = 0; hi.number - lo.number > 1n && step < 64; step++) {
    let guess =
      step === 0
        ? hi.number - (hi.timestamp - timestamp) / SLOT_SECONDS
        : step % 3 === 2
          ? (lo.number + hi.number) / 2n
          : lo.number + ((timestamp - lo.timestamp) * (hi.number - lo.number)) / (hi.timestamp - lo.timestamp)
    if (guess <= lo.number) guess = lo.number + 1n
    if (guess >= hi.number) guess = hi.number - 1n
    const block = await publicClient.getBlock({ blockNumber: guess })
    if (block.timestamp === timestamp) return block.number
    if (block.timestamp < timestamp) lo = block
    else hi = block
  }
  return orAfter && hi.number - lo.number <= 1n ? hi.number : undefined
}

/**
 * The transaction that created a poll. The board stores no transaction hash, and an RPC serves only 50 000 blocks of logs at a time,
 * so the poll's creation time (the timestamp of its block) names the one block to read the `PollCreated` event from.
 */
export async function findPollCreationTx(pollId: bigint, createdAt: number): Promise<Hex | undefined> {
  const block = await blockAtTimestamp(BigInt(createdAt))
  if (block === undefined) return undefined
  const [log] = await publicClient.getLogs({ address: BOARD_ADDRESS, event: pollCreated, args: { pollId }, fromBlock: block, toBlock: block })
  return log?.transactionHash ?? undefined
}

/** Undefined while loading and when the transaction cannot be found: the link is an extra, never a reason to fail the page. */
export const usePollCreationTx = (poll: { id: bigint; createdAt: number }) =>
  useQuery({
    queryKey: ['poll-creation-tx', BOARD_ADDRESS, poll.id.toString()],
    queryFn: () => findPollCreationTx(poll.id, poll.createdAt),
    staleTime: Infinity,
    retry: 1,
  }).data

const inputRootSubmitted = getAbiItem({ abi: crispAztecProgramAbi, name: 'InputRootSubmitted' })

/**
 * The Ethereum transaction that delivered a round's input root (the keeper's `submitInputRoot`): the program's `InputRootSubmitted`
 * event, which can only be emitted after the window closed, so the search starts at the block of the close.
 */
export async function findInputRootTx(program: Address, e3Id: bigint, closesAt: number): Promise<Hex | undefined> {
  const from = await blockAtTimestamp(BigInt(closesAt), true)
  if (from === undefined) return undefined
  const [log] = await publicClient.getLogs({ address: program, event: inputRootSubmitted, args: { e3Id }, fromBlock: from, toBlock: 'latest' })
  return log?.transactionHash ?? undefined
}

/** Undefined while loading, before the root arrives and when it cannot be found: the link is an extra. */
export const useInputRootTx = (poll: { program: Address; e3Id: bigint; closesAt: number; rootSubmitted: boolean }) =>
  useQuery({
    queryKey: ['input-root-tx', poll.e3Id.toString()],
    queryFn: () => findInputRootTx(poll.program, poll.e3Id, poll.closesAt),
    enabled: poll.rootSubmitted,
    staleTime: Infinity,
    retry: 1,
  }).data
