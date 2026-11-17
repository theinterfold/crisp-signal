import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useWriteContract } from 'wagmi'
import { ArrowLeft } from '@phosphor-icons/react'
import { BOARD_ADDRESS, CHAIN } from '../config'
import { crispSignalAztecAbi } from '../lib/abi'
import { eligibilityChips, errorMessage, formatDate, shortAddress, shortHex, timing } from '../lib/format'
import { fetchMetadata } from '../lib/ipfs'
import { phaseOf, usePoll, type Phase, type Poll } from '../lib/polls'
import { publicClient } from '../lib/wagmi'
import { Notice, PhaseBadge, Results } from '../components/PollBits'
import { VotePanel } from '../components/VotePanel'
import { useDeployment } from '../lib/aztec'

const explorer = CHAIN.blockExplorers.default.url

function parseId(raw: string | undefined) {
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined
}

export function PollPage() {
  const id = parseId(useParams().id)
  const poll = usePoll(id)
  const metadata = useQuery({
    queryKey: ['metadata', poll.data?.metadataCid],
    queryFn: () => fetchMetadata(poll.data!.metadataCid),
    enabled: Boolean(poll.data),
    staleTime: Infinity,
  })
  const { address } = useAccount()

  if (id === undefined) return <Notice tone="error">That is not a poll id.</Notice>
  if (poll.error) return <Notice tone="error">Could not load poll #{id.toString()}: {errorMessage(poll.error)}</Notice>
  if (!poll.data) return <p className="muted">Loading poll…</p>

  const p = poll.data
  const phase = phaseOf(p)
  const options = metadata.data?.options ?? Array.from({ length: p.numOptions }, (_, i) => `Option ${i + 1}`)
  const title = metadata.data?.title ?? `Poll #${p.id}`
  const optionMismatch = metadata.data && metadata.data.options.length !== p.numOptions

  return (
    <>
      <Link to="/" className="btn ghost sm" style={{ marginBottom: 16, marginLeft: -10 }}>
        <ArrowLeft size={14} /> All polls
      </Link>
      <div className="detail-grid">
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <PhaseBadge phase={phase} />
            <span className="eyebrow">Poll #{p.id.toString()}</span>
            {metadata.data?.organisation && <span className="eyebrow">· {metadata.data.organisation}</span>}
          </div>
          <h1>{title}</h1>
          <p className="muted small" style={{ margin: '10px 0 24px' }}>
            {timing(phase, p.opensAt, p.closesAt)} · Created by{' '}
            <a href={`${explorer}/address/${p.creator}`} target="_blank" rel="noreferrer" className="mono">
              {shortAddress(p.creator)}
            </a>
          </p>
          {metadata.error && <Notice tone="warning">Poll details could not be loaded from IPFS: {errorMessage(metadata.error)}</Notice>}
          {optionMismatch && (
            <Notice tone="error">
              The IPFS metadata lists {metadata.data!.options.length} options but the ballot has {p.numOptions}. Treat the
              labels with suspicion.
            </Notice>
          )}
          {metadata.data?.description && (
            <section className="card">
              <p className="prose">{metadata.data.description}</p>
            </section>
          )}

          <section className="card">
            <div className="card-title">
              <h2>Results</h2>
              <span className="eyebrow">{p.aztec ? `${p.aztec.inputs} inputs on Aztec` : 'Aztec status unavailable'}</span>
            </div>
            {p.tally ? (
              <Results options={options} tally={p.tally} />
            ) : (
              <p className="muted small">{resultsPending(phase, p)}</p>
            )}
          </section>

          <Eligibility poll={p} />
          <Details poll={p} phase={phase} />
        </div>

        <aside style={{ position: 'sticky', top: 24 }}>
          <section className="card">
            <div className="card-title">
              <h2>Vote</h2>
              <span className="eyebrow">{p.aztec ? `${p.aztec.members.length} verified` : ''}</span>
            </div>
            <VotePanel key={p.e3Id.toString()} poll={p} phase={phase} options={options} title={title} />
          </section>
          {phase === 'failed' && address?.toLowerCase() === p.creator.toLowerCase() && <Refund poll={p} />}
        </aside>
      </div>
    </>
  )
}

/** What is left once voting has closed, by where the round has got to. */
function resultsPending(phase: Phase, poll: Poll) {
  switch (phase) {
    case 'tallying':
      return poll.rootSubmitted
        ? 'Voting has closed. The tally is being computed over the encrypted ballots.'
        : `Voting has closed. The round is sealed on Aztec and its input root reaches Ethereum once Aztec proves the epoch, usually 1–2 hours after the close. The tally is then computed and decrypted, so results follow after that.`
    case 'decrypting':
      return 'The encrypted tally is ready; the committee is decrypting it.'
    case 'failed':
      return 'This round failed before producing a result.'
    case 'stalled':
      return 'The committee did not publish a key before the window closed, so no ballots could be cast.'
    default:
      return 'Ballots stay encrypted. Only the final tally is decrypted, after voting closes.'
  }
}

function Eligibility({ poll }: { poll: Poll }) {
  return (
    <section className="card">
      <h2 style={{ marginBottom: 14 }}>Who can vote</h2>
      <div className="chips" style={{ marginBottom: 14 }}>
        {eligibilityChips(poll).map((chip) => (
          <span className="chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>
      {poll.allowMockDocuments && (
        <Notice tone="warning">This poll accepts ZKPassport mock IDs, which anyone can create. Use it for testing only.</Notice>
      )}
    </section>
  )
}

function Details({ poll, phase }: { poll: Poll; phase: Phase }) {
  const aztec = useDeployment()
  return (
    <section className="card">
      <h2 style={{ marginBottom: 14 }}>Details</h2>
      <dl className="kv">
        <dt>Voting opens</dt>
        <dd>{formatDate(poll.opensAt)}</dd>
        <dt>Voting closes</dt>
        <dd>{formatDate(poll.closesAt)}</dd>
        <dt>Options</dt>
        <dd>{poll.numOptions}</dd>
        <dt>Aztec round</dt>
        <dd>{aztecRound(poll)}</dd>
        <dt>Registered voters</dt>
        <dd>{poll.aztec ? poll.aztec.members.length : '—'}</dd>
        <dt>Inputs on Aztec</dt>
        <dd>{poll.aztec ? poll.aztec.inputs : '—'}</dd>
        {poll.rootSubmitted && (
          <>
            <dt>Input root on Ethereum</dt>
            <dd>delivered</dd>
          </>
        )}
        {phase === 'tallying' && !poll.rootSubmitted && (
          <>
            <dt>Input root on Ethereum</dt>
            <dd>after the Aztec epoch proof</dd>
          </>
        )}
        <dt>Interfold E3</dt>
        <dd className="mono" title={poll.e3Id.toString()}>
          {shortHex(poll.e3Id.toString())}
        </dd>
        <dt>CRISP program</dt>
        <dd className="mono">
          <a href={`${explorer}/address/${poll.program}`} target="_blank" rel="noreferrer">
            {shortAddress(poll.program)}
          </a>
        </dd>
        {aztec.data && (
          <>
            <dt>Aztec contract</dt>
            <dd className="mono" title={aztec.data.aztecContract}>
              {shortHex(aztec.data.aztecContract)}
            </dd>
          </>
        )}
        <dt>Metadata</dt>
        <dd className="mono" title={poll.metadataCid}>
          {shortHex(poll.metadataCid)}
        </dd>
      </dl>
    </section>
  )
}

function aztecRound(poll: Poll) {
  if (!poll.aztec) return 'unavailable'
  if (poll.aztec.closed) return 'closed'
  if (poll.aztec.keyPublished) return 'open for ballots'
  if (poll.aztec.opened) return 'waiting for the committee key'
  return 'not opened yet'
}

function Refund({ poll }: { poll: Poll }) {
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: boolean }>({})

  async function claim() {
    setState({ busy: true })
    try {
      const hash = await writeContractAsync({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'claimRefund', args: [poll.id], chainId: CHAIN.id })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The refund transaction reverted.')
      setState({ done: true })
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
        <Notice tone="success">Refund claimed.</Notice>
      ) : (
        <button className="btn secondary" disabled={state.busy} onClick={claim}>
          {state.busy ? 'Claiming…' : 'Claim refund'}
        </button>
      )}
    </section>
  )
}
