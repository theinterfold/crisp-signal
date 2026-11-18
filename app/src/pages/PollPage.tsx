import { lazy, Suspense, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from '@phosphor-icons/react'
import { BOARD_ADDRESS } from '../config'
import { countryNames, eligibilityChips, errorMessage, formatDate, shortAddress, shortHex, timing } from '../lib/format'
import { useNow } from '../lib/clock'
import { fetchMetadata } from '../lib/ipfs'
import { NationalityMode, phaseOf, usePoll, useRulesCheck, type Phase, type Poll } from '../lib/polls'
import { Notice, PhaseBadge, Results } from '../components/PollBits'
import { ResultStatus } from '../components/ResultStatus'
import { VotePanel } from '../components/VotePanel'
import { useDeployment } from '../lib/aztec'
import { useInputRootTx, usePollCreationTx } from '../lib/explorer'
import { warmUp } from '../lib/warmup'
import { ExplorerLink } from '../components/ExplorerLink'

// The wallet stack loads only for the creator of a failed poll.
const CreatorRefund = lazy(() => import('../components/CreatorRefund'))

/** A poll that is open or about to open: ballots are coming, so the prover is prepared while the voter reads. */
const warmsUp = (phase: Phase) => phase === 'open' || phase === 'preparing' || phase === 'scheduled'

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

  // The phase follows the clock: the page re-renders when voting opens or closes (the poll query alone would not, as an unchanged
  // answer does not re-render it), and then re-reads what only the chain can say (the round opened, the key relayed, the root, the result).
  const queryClient = useQueryClient()
  const now = useNow(poll.data ? [poll.data.opensAt, poll.data.closesAt] : [], () =>
    queryClient.invalidateQueries({ queryKey: ['poll', id?.toString()] }),
  )
  const paramSet = poll.data?.paramSet
  const warm = poll.data !== undefined && warmsUp(phaseOf(poll.data, now))
  useEffect(() => {
    // Idempotent, in the background and without proving: the vote, mask and registration flows reuse what it prepares.
    if (warm && paramSet !== undefined) void warmUp(paramSet)
  }, [warm, paramSet])

  if (id === undefined) return <Notice tone="error">That is not a poll id.</Notice>
  if (poll.error) return <Notice tone="error">Could not load poll #{id.toString()}: {errorMessage(poll.error)}</Notice>
  if (!poll.data) return <p className="muted">Loading poll…</p>

  const p = poll.data
  const phase = phaseOf(p, now)
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
            {timing(phase, p.opensAt, p.closesAt, now)} · Created by{' '}
            <ExplorerLink chain="l1" kind="address" id={p.creator} label={shortAddress(p.creator)} />
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
            ) : phase === 'tallying' || phase === 'decrypting' ? (
              <>
                <p className="muted small" style={{ marginBottom: 14 }}>
                  Voting has closed. Results take a while: the votes are sealed on Aztec, their root goes to Ethereum, and only then is the tally
                  computed and decrypted.
                </p>
                <ResultStatus poll={p} now={now} />
              </>
            ) : (
              <p className="muted small">{resultsPending(phase)}</p>
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
          {phase === 'failed' && (
            <Suspense fallback={null}>
              <CreatorRefund poll={p} />
            </Suspense>
          )}
        </aside>
      </div>
    </>
  )
}

/** What the Results card says before there is anything to show, outside the closed-and-waiting phases. */
function resultsPending(phase: Phase) {
  switch (phase) {
    case 'failed':
      return 'This round failed before producing a result.'
    case 'stalled':
      return 'The committee did not publish a key before the window closed, so no ballots could be cast.'
    default:
      return 'Ballots stay encrypted. Only the final tally is decrypted, after voting closes.'
  }
}

function Eligibility({ poll }: { poll: Poll }) {
  const { rules } = poll
  const check = useRulesCheck(poll)
  return (
    <section className="card">
      <h2 style={{ marginBottom: 14 }}>Who can vote</h2>
      <div className="chips" style={{ marginBottom: 14 }}>
        {eligibilityChips(rules).map((chip) => (
          <span className="chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>
      {/* The chip names up to three countries; longer lists are written out. */}
      {rules.nationalityMode !== NationalityMode.None && rules.countries.length > 3 && (
        <p className="muted small" style={{ marginBottom: 14 }}>
          {rules.nationalityMode === NationalityMode.In ? 'Only nationals of' : 'Nationals of the following cannot vote:'}{' '}
          {countryNames(rules.countries).join(', ')}.
        </p>
      )}
      <p className="muted small" style={{ marginBottom: 14 }}>
        Voters register with ZKPassport on Aztec, from their browser, and cast their ballots there.
      </p>
      {check.data && !check.data.ok && <Notice tone="error">{check.data.reason} Do not register for this poll.</Notice>}
      {rules.allowMockDocuments && (
        <Notice tone="warning">This poll accepts ZKPassport mock IDs, which anyone can create. Use it for testing only.</Notice>
      )}
    </section>
  )
}

/** The first and the latest of a run of Aztec transactions (in order), as explorer links. */
function TxRange({ txs }: { txs: string[] }) {
  if (txs.length === 0) return null
  return (
    <>
      {' · '}
      <ExplorerLink chain="aztec" kind="tx" id={txs[0]} label={txs.length > 1 ? 'first tx' : 'tx'} />
      {txs.length > 1 && (
        <>
          {' · '}
          <ExplorerLink chain="aztec" kind="tx" id={txs[txs.length - 1]} label="latest tx" />
        </>
      )}
    </>
  )
}

function Details({ poll, phase }: { poll: Poll; phase: Phase }) {
  const aztec = useDeployment()
  const creationTx = usePollCreationTx(poll)
  const txs = poll.aztec?.txs
  const rootTx = useInputRootTx(poll)
  return (
    <section className="card">
      <h2 style={{ marginBottom: 14 }}>Details</h2>
      <dl className="kv">
        <dt>Created</dt>
        <dd>
          {formatDate(poll.createdAt)}
          {creationTx && (
            <>
              {' · '}
              <ExplorerLink chain="l1" kind="tx" id={creationTx} />
            </>
          )}
        </dd>
        <dt>Voting opens</dt>
        <dd>{formatDate(poll.opensAt)}</dd>
        <dt>Voting closes</dt>
        <dd>{formatDate(poll.closesAt)}</dd>
        <dt>Options</dt>
        <dd>{poll.numOptions}</dd>
      </dl>
      <details className="fold">
        <summary>On-chain details</summary>
        <dl className="kv">
          <dt>Aztec round</dt>
          <dd>{aztecRound(poll)}</dd>
          {txs?.opened && (
            <>
              <dt>Round opened</dt>
              <dd>
                <ExplorerLink chain="aztec" kind="tx" id={txs.opened} />
              </dd>
            </>
          )}
          {txs?.keyPublished && (
            <>
              <dt>Key published</dt>
              <dd>
                <ExplorerLink chain="aztec" kind="tx" id={txs.keyPublished} />
              </dd>
            </>
          )}
          <dt>Registered voters</dt>
          <dd>
            {poll.aztec ? poll.aztec.members.length : '—'}
            {txs && <TxRange txs={txs.members} />}
          </dd>
          <dt>Inputs on Aztec</dt>
          <dd>
            {poll.aztec ? poll.aztec.inputs : '—'}
            {txs && <TxRange txs={txs.inputs} />}
          </dd>
          {txs?.closed && (
            <>
              <dt>Round closed</dt>
              <dd>
                <ExplorerLink chain="aztec" kind="tx" id={txs.closed} />
              </dd>
            </>
          )}
          {poll.rootSubmitted && (
            <>
              <dt>Input root on Ethereum</dt>
              <dd>
                {rootTx ? <ExplorerLink chain="l1" kind="tx" id={rootTx} /> : 'delivered'}
              </dd>
            </>
          )}
          {phase === 'tallying' && !poll.rootSubmitted && (
            <>
              <dt>Input root on Ethereum</dt>
              <dd>after the Aztec epoch proof (about 1–2 hours after the close, an estimate)</dd>
            </>
          )}
          <dt>Interfold E3</dt>
          <dd className="mono" title={poll.e3Id.toString()}>
            {shortHex(poll.e3Id.toString())}
          </dd>
          <dt>Poll board</dt>
          <dd>
            <ExplorerLink chain="l1" kind="address" id={BOARD_ADDRESS} label={shortAddress(BOARD_ADDRESS)} />
          </dd>
          <dt>CRISP program</dt>
          <dd>
            <ExplorerLink chain="l1" kind="address" id={poll.program} label={shortAddress(poll.program)} />
          </dd>
          {aztec.data && (
            <>
              <dt>Aztec contract</dt>
              <dd>
                <ExplorerLink chain="aztec" kind="contract" id={aztec.data.aztecContract} />
              </dd>
            </>
          )}
          <dt>Metadata</dt>
          <dd className="mono" title={poll.metadataCid}>
            {shortHex(poll.metadataCid)}
          </dd>
        </dl>
      </details>
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
