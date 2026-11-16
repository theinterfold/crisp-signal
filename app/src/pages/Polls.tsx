import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from '@phosphor-icons/react'
import { MiniBar, Notice, PhaseBadge } from '../components/PollBits'
import { eligibilityChips, errorMessage, timing } from '../lib/format'
import { fetchMetadata } from '../lib/ipfs'
import { phaseOf, usePolls, type Poll } from '../lib/polls'

export function PollsPage() {
  const polls = usePolls()

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">CRISP Signal</span>
          <h1 style={{ marginTop: 8 }}>Polls</h1>
          <p>
            Secret-ballot signalling for verified people. Each eligible passport or national ID casts one encrypted
            vote; only the final tally is ever decrypted.
          </p>
        </div>
        <Link to="/create" className="btn">
          <Plus size={16} weight="bold" /> New poll
        </Link>
      </div>

      {polls.isPending && <p className="muted">Loading polls…</p>}
      {polls.error && <Notice tone="error">Could not load polls: {errorMessage(polls.error)}</Notice>}
      {polls.data?.length === 0 && (
        <div className="card empty">
          <h2>No polls yet</h2>
          <p>Create the first one: write the question, choose who may vote, and pay the Interfold committee fee.</p>
          <Link to="/create" className="btn">
            Create a poll
          </Link>
        </div>
      )}
      <div className="poll-list">
        {polls.data?.map((poll) => <PollRow key={poll.id.toString()} poll={poll} />)}
      </div>
    </>
  )
}

function PollRow({ poll }: { poll: Poll }) {
  const metadata = useQuery({ queryKey: ['metadata', poll.metadataCid], queryFn: () => fetchMetadata(poll.metadataCid), staleTime: Infinity })
  const phase = phaseOf(poll)

  return (
    <Link to={`/poll/${poll.id}`} className="poll-row">
      <div>
        <div className="row">
          <PhaseBadge phase={phase} />
          <span className="eyebrow">#{poll.id.toString()}</span>
          {metadata.data?.organisation && <span className="eyebrow">· {metadata.data.organisation}</span>}
        </div>
        <h3>{metadata.data?.title ?? (metadata.error ? 'Metadata unavailable' : 'Loading…')}</h3>
        {metadata.data && <p className="desc">{metadata.data.description}</p>}
        <div className="chips" style={{ marginTop: 12 }}>
          {eligibilityChips(poll.policy).map((chip) => (
            <span className="chip" key={chip}>
              {chip}
            </span>
          ))}
        </div>
      </div>
      <div className="poll-side">
        <span className="small">{timing(phase, poll.opensAt, poll.closesAt)}</span>
        <div className="stat-line">
          Verified voters <strong>{poll.registrants}</strong>
        </div>
        <div className="stat-line">
          Ballots submitted <strong>{poll.ballots}</strong>
        </div>
        <div className="stat-line">
          Options <strong>{poll.numOptions}</strong>
        </div>
        {poll.tally && <MiniBar tally={poll.tally} />}
      </div>
    </Link>
  )
}
