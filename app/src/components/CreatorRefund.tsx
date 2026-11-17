import type { Hex } from 'viem'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useWriteContract } from 'wagmi'
import { BOARD_ADDRESS, CHAIN } from '../config'
import { crispSignalAztecAbi } from '../lib/abi'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'
import type { Poll } from '../lib/polls'
import WalletProvider from '../lib/wallet'
import { ConnectButton } from './ConnectButton'
import { ExplorerLink } from './ExplorerLink'
import { Notice } from './PollBits'

/**
 * Only the poll's creator (a wallet user) can claim the refund of a failed round; voters never touch the wallet. This is the only part of
 * the poll page that needs the wallet stack, so the page loads it on demand.
 */
export default function CreatorRefund({ poll }: { poll: Poll }) {
  return (
    <WalletProvider>
      <Claim poll={poll} />
    </WalletProvider>
  )
}

function Claim({ poll }: { poll: Poll }) {
  const { address } = useAccount()
  if (address?.toLowerCase() === poll.creator.toLowerCase()) return <Refund poll={poll} />
  if (address) return null
  return (
    <section className="card stack">
      <h3>Refund</h3>
      <p className="muted small">The round failed. The creator of this poll can connect the wallet they created it with to claim the fee refund.</p>
      <ConnectButton />
    </section>
  )
}

function Refund({ poll }: { poll: Poll }) {
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: Hex }>({})

  async function claim() {
    setState({ busy: true })
    try {
      const hash = await writeContractAsync({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'claimRefund', args: [poll.id], chainId: CHAIN.id })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The refund transaction reverted.')
      setState({ done: hash })
      await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
    } catch (e) {
      setState({ error: errorMessage(e) })
    }
  }

  return (
    <section className="card stack">
      <h3>Refund</h3>
      <p className="muted small">The round failed. Claim the requester's share of the fee back to your wallet.</p>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.done ? (
        <Notice tone="success">
          Refund claimed. <ExplorerLink chain="l1" kind="tx" id={state.done} />
        </Notice>
      ) : (
        <button className="btn secondary" disabled={state.busy} onClick={claim}>
          {state.busy ? 'Claiming…' : 'Claim refund'}
        </button>
      )}
    </section>
  )
}
