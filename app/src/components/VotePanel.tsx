import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { CheckCircle } from '@phosphor-icons/react'
import { exportSecrets, slotKeys } from '../lib/aztec'
import { errorMessage, formatDate, OPTION_COLORS } from '../lib/format'
import type { Phase, Poll } from '../lib/polls'
import { inputReceipt, randomRegistrant, submitBallot, type BallotKind, type InputKind, type VoteProgress, type VoteStep } from '../lib/vote'
import { PassportStep } from './PassportStep'
import { Notice } from './PollBits'

const STEPS: Record<InputKind, { step: VoteStep; label: string }[]> = {
  vote: [
    { step: 'connecting', label: 'Connect to Aztec' },
    { step: 'encrypting', label: 'Encrypt to the committee key and sign' },
    { step: 'proving', label: 'Prove the ballot in your browser' },
    { step: 'staging', label: 'Have the CRISP server store it' },
    { step: 'sending', label: 'Cast on Aztec' },
  ],
  mask: [
    { step: 'connecting', label: 'Connect to Aztec' },
    { step: 'encrypting', label: 'Encrypt an empty ballot' },
    { step: 'proving', label: 'Prove it in your browser' },
    { step: 'staging', label: 'Have the CRISP server store it' },
    { step: 'sending', label: 'Cast on Aztec' },
  ],
}

type MaskTarget = 'random' | 'self'

function StepRow({ index, label, state, detail }: { index: number; label: string; state: 'done' | 'active' | 'todo'; detail?: string }) {
  return (
    <div className={`step ${state === 'todo' ? '' : state}`}>
      <span className="step-icon">{state === 'done' ? '✓' : state === 'active' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : index}</span>
      <span>
        <span className="step-label">{label}</span>
        {detail && <div className="step-detail">{detail}</div>}
      </span>
    </div>
  )
}

function Progress({ kind, progress }: { kind: InputKind; progress: VoteProgress }) {
  const steps = STEPS[kind]
  const current = steps.findIndex((s) => s.step === progress.step)
  return (
    <div className="steps" style={{ marginTop: 4 }}>
      {steps.map((s, i) => (
        <StepRow
          key={s.step}
          index={i + 1}
          label={s.label}
          state={i < current ? 'done' : i === current ? 'active' : 'todo'}
          detail={
            i === current
              ? progress.proofTotal
                ? `${progress.detail} (${(progress.proofIndex ?? 0) + 1}/${progress.proofTotal}: ${progress.proofStage})`
                : progress.detail
              : undefined
          }
        />
      ))}
    </div>
  )
}

/** The Aztec transaction, shortened: there is no public explorer link to rely on for the testnet. */
function TxHash({ hash }: { hash: string }) {
  return (
    <>
      {' '}
      <span className="mono" title={hash}>
        Aztec tx {hash.slice(0, 10)}…{hash.slice(-6)}
      </span>
    </>
  )
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function VotePanel({ poll, phase, options, title }: { poll: Poll; phase: Phase; options: string[]; title: string }) {
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<number>()
  const [running, setRunning] = useState<{ kind: InputKind; progress: VoteProgress }>()
  const [error, setError] = useState<{ kind: InputKind; message: string }>()
  const [voteReceipt, setVoteReceipt] = useState(() => inputReceipt.get('vote', poll.e3Id))
  const [maskReceipt, setMaskReceipt] = useState(() => inputReceipt.get('mask', poll.e3Id))
  const [changing, setChanging] = useState(false)
  // Re-render when a registration lands, so the slot key made for it is read again.
  const [, refresh] = useState(0)

  const slotKey = slotKeys.get(poll.e3Id)
  const slot = slotKey ? slotKeys.address(slotKey) : undefined
  const members = poll.aztec?.members ?? []
  const isRegistered = Boolean(slot) && members.some((member) => member.toLowerCase() === slot!.toLowerCase())

  const busy = running !== undefined
  const closed = ['tallying', 'decrypting', 'final', 'failed', 'stalled'].includes(phase)

  async function submit(kind: InputKind, target: Address, ballot: BallotKind) {
    setError(undefined)
    setRunning({ kind, progress: { step: 'connecting' } })
    try {
      const txHash = await submitBallot({
        e3Id: poll.e3Id,
        slot: target,
        numOptions: poll.numOptions,
        ballot,
        onProgress: (progress) => setRunning({ kind, progress }),
      })
      inputReceipt.set(kind, poll.e3Id, { txHash, slot: target })
      await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
      return inputReceipt.get(kind, poll.e3Id)
    } catch (e) {
      console.error(`Casting the ${kind} failed`, e)
      setError({ kind, message: errorMessage(e) })
      return undefined
    } finally {
      setRunning(undefined)
    }
  }

  async function vote() {
    if (choice === undefined || !slot) return
    const receipt = await submit('vote', slot, { kind: 'vote', option: choice })
    if (receipt) {
      setVoteReceipt(receipt)
      setChanging(false)
      setChoice(undefined)
    }
  }

  async function mask(target: MaskTarget) {
    let address: Address
    try {
      if (target === 'self') {
        if (!slot) throw new Error('This browser holds no registered slot for this poll.')
        address = slot
      } else {
        address = randomRegistrant(members)
      }
    } catch (e) {
      setError({ kind: 'mask', message: errorMessage(e) })
      return
    }
    const receipt = await submit('mask', address, { kind: 'mask' })
    if (receipt) setMaskReceipt(receipt)
  }

  return (
    <div className="stack">
      <div>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="label">1 · Prove you are eligible</span>
          {isRegistered && (
            <span className="badge open">
              <CheckCircle size={12} weight="bold" /> Verified
            </span>
          )}
        </div>
        {!poll.aztec && <Notice tone="warning">The Aztec node could not be read, so registrations cannot be checked right now.</Notice>}
        {poll.aztec && !isRegistered &&
          (closed ? (
            <p className="muted small">Voting has closed.</p>
          ) : (
            <>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Scan with the ZKPassport app and tap your passport or ID card on your phone. The proof reveals only that
                you meet the rules and that this document has not registered for this poll before. It is bound to an
                Aztec account this browser creates for you; no Ethereum wallet is needed.
              </p>
              <PassportStep poll={poll} title={title} onRegistered={() => refresh((n) => n + 1)} />
            </>
          ))}
      </div>

      <hr className="divider" style={{ margin: '4px 0' }} />

      <div>
        <span className="label">2 · Cast your secret ballot</span>
        {voteReceipt && !changing && running?.kind !== 'vote' ? (
          <div className="stack" style={{ marginTop: 12, gap: 10 }}>
            <Notice tone="success">
              Ballot cast {formatDate(Math.floor(voteReceipt.at / 1000))}. Nobody, including the committee, can see which
              option you chose; only the final tally is decrypted.
              <TxHash hash={voteReceipt.txHash} />
            </Notice>
            {phase === 'open' && (
              <button className="link-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => setChanging(true)}>
                Change my vote — your latest ballot is the one counted
              </button>
            )}
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            {options.map((option, i) => (
              <button
                key={i}
                className={`choice ${choice === i ? 'selected' : ''}`}
                disabled={!isRegistered || phase !== 'open' || busy}
                onClick={() => setChoice(i)}
              >
                <span className="radio" />
                <span className="swatch" style={{ background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
                {option}
              </button>
            ))}
            {phase === 'preparing' && <Notice>The committee is still generating this poll's key, or the keeper has not yet relayed it to Aztec. Voting opens once it is there.</Notice>}
            {phase === 'scheduled' && <Notice>Voting opens {formatDate(poll.opensAt)}.</Notice>}
            {phase === 'open' && !isRegistered && <Notice>Verify your ID first; then choose an option.</Notice>}
            {running?.kind === 'vote' && <Progress kind="vote" progress={running.progress} />}
            {error?.kind === 'vote' && <Notice tone="error">{error.message}</Notice>}
            <button
              className="btn brand block"
              disabled={choice === undefined || !isRegistered || phase !== 'open' || busy}
              onClick={vote}
            >
              {running?.kind === 'vote' ? 'Casting ballot…' : 'Encrypt and cast vote'}
            </button>
            {changing && !busy && (
              <button className="btn ghost sm" onClick={() => setChanging(false)}>
                Keep my current ballot
              </button>
            )}
          </div>
        )}
      </div>

      {phase === 'open' && (
        <>
          <hr className="divider" style={{ margin: '4px 0' }} />
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">Optional · Add a mask</span>
            <p className="muted small">
              A mask is an empty encrypted ballot added to a verified voter's slot. It never changes anyone's choice, but
              on Aztec it looks exactly like a vote or a re-vote, so nobody can prove from the chain how, or whether, a
              voter voted. Masking a random voter gives them cover; masking your own slot covers your own activity.
            </p>
            {maskReceipt && running?.kind !== 'mask' && (
              <Notice tone="success">
                Mask submitted {formatDate(Math.floor(maskReceipt.at / 1000))}.
                <TxHash hash={maskReceipt.txHash} />
              </Notice>
            )}
            {running?.kind === 'mask' && <Progress kind="mask" progress={running.progress} />}
            {error?.kind === 'mask' && <Notice tone="error">{error.message}</Notice>}
            <div className="row">
              <button className="btn secondary sm" disabled={busy || members.length === 0} onClick={() => mask('random')}>
                Mask a random voter
              </button>
              <button className="btn secondary sm" disabled={busy || !isRegistered} onClick={() => mask('self')}>
                Mask my own slot
              </button>
            </div>
          </div>
        </>
      )}

      {slotKey && (
        <p className="muted small">
          Your slot key and Aztec account live in this browser only; clearing its storage forfeits this registration.{' '}
          <button className="link-btn" onClick={() => download('crisp-signal-keys.json', exportSecrets())}>
            Download a backup
          </button>
        </p>
      )}
    </div>
  )
}
