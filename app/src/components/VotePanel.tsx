import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignTypedData, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CheckCircle } from '@phosphor-icons/react'
import { CHAIN } from '../config'
import { crispProgramAbi, passportRegistryAbi } from '../lib/abi'
import { errorMessage, formatDate, OPTION_COLORS } from '../lib/format'
import type { Phase, Poll } from '../lib/polls'
import { inputReceipt, randomRegistrant, submitBallot, type BallotKind, type InputKind, type VoteProgress, type VoteStep } from '../lib/vote'
import { publicClient } from '../lib/wagmi'
import { PassportStep } from './PassportStep'
import { Notice } from './PollBits'

const STEPS: Record<InputKind, { step: VoteStep; label: string }[]> = {
  vote: [
    { step: 'encrypting', label: 'Encrypt to the committee key' },
    { step: 'signing', label: 'Sign the ballot' },
    { step: 'proving', label: 'Prove it in your browser' },
    { step: 'submitting', label: 'Submit through the CRISP relay' },
    { step: 'confirming', label: 'Recorded on-chain' },
  ],
  mask: [
    { step: 'encrypting', label: 'Encrypt an empty ballot' },
    { step: 'proving', label: 'Prove it in your browser' },
    { step: 'submitting', label: 'Submit through the CRISP relay' },
    { step: 'confirming', label: 'Recorded on-chain' },
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

function TxLink({ hash }: { hash: Hex | null }) {
  if (!hash) return null
  return (
    <>
      {' '}
      <a href={`${CHAIN.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">
        View transaction
      </a>
    </>
  )
}

export function VotePanel({ poll, phase, account, options, title }: { poll: Poll; phase: Phase; account: Address; options: string[]; title: string }) {
  const queryClient = useQueryClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const [choice, setChoice] = useState<number>()
  const [running, setRunning] = useState<{ kind: InputKind; progress: VoteProgress }>()
  const [error, setError] = useState<{ kind: InputKind; message: string }>()
  const [voteReceipt, setVoteReceipt] = useState(() => inputReceipt.get('vote', poll.e3Id, account))
  const [maskReceipt, setMaskReceipt] = useState(() => inputReceipt.get('mask', poll.e3Id, account))
  const [changing, setChanging] = useState(false)

  const registered = useQuery({
    queryKey: ['registered', poll.registry, account],
    queryFn: () =>
      publicClient.readContract({ address: poll.registry, abi: passportRegistryAbi, functionName: 'isRegistered', args: [account] }),
  })

  const busy = running !== undefined
  const closed = ['tallying', 'decrypting', 'final', 'failed', 'stalled'].includes(phase)
  const isRegistered = registered.data === true

  async function submit(kind: InputKind, slot: Address, ballot: BallotKind) {
    setError(undefined)
    setRunning({ kind, progress: { step: 'encrypting' } })
    try {
      const txHash = await submitBallot({
        e3Id: poll.e3Id,
        slot,
        numOptions: poll.numOptions,
        ballot,
        onProgress: (progress) => setRunning({ kind, progress }),
        publishFromWallet: ({ program, payload }) =>
          writeContractAsync({ address: program, abi: crispProgramAbi, functionName: 'publishInput', args: [poll.e3Id, payload] }),
      })
      inputReceipt.set(kind, poll.e3Id, account, { txHash, slot })
      await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
      return inputReceipt.get(kind, poll.e3Id, account)
    } catch (e) {
      setError({ kind, message: errorMessage(e) })
      return undefined
    } finally {
      setRunning(undefined)
    }
  }

  async function vote() {
    if (choice === undefined) return
    const receipt = await submit('vote', account, {
      kind: 'vote',
      option: choice,
      signBallot: ({ program, ctCommitment }) =>
        signTypedDataAsync({
          domain: { name: 'CRISP', version: '1', chainId: CHAIN.id, verifyingContract: program },
          types: { Ballot: [{ name: 'e3Id', type: 'uint256' }, { name: 'slot', type: 'address' }, { name: 'ciphertextCommitment', type: 'bytes32' }] },
          primaryType: 'Ballot',
          message: { e3Id: poll.e3Id, slot: account, ciphertextCommitment: ctCommitment },
        }),
    })
    if (receipt) {
      setVoteReceipt(receipt)
      setChanging(false)
      setChoice(undefined)
    }
  }

  async function mask(target: MaskTarget) {
    let slot: Address
    try {
      slot = target === 'self' ? account : await randomRegistrant(poll.registry)
    } catch (e) {
      setError({ kind: 'mask', message: errorMessage(e) })
      return
    }
    const receipt = await submit('mask', slot, { kind: 'mask' })
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
        {registered.isPending && <p className="muted small">Checking registration…</p>}
        {registered.data === false &&
          (closed ? (
            <p className="muted small">Voting has closed.</p>
          ) : (
            <>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Scan with the ZKPassport app and tap your passport or ID card on your phone. The proof reveals only that
                you meet the rules and that this document has not registered for this poll before; it is bound to your
                wallet address.
              </p>
              <PassportStep poll={poll} account={account} title={title} />
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
              <TxLink hash={voteReceipt.txHash} />
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
            {phase === 'preparing' && <Notice>The committee is still generating this poll's key. Voting opens once it is published.</Notice>}
            {phase === 'scheduled' && <Notice>Voting opens {formatDate(poll.opensAt)}.</Notice>}
            {phase === 'open' && registered.data === false && <Notice>Verify your ID first; then choose an option.</Notice>}
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
              on-chain it looks exactly like a vote or a re-vote, so nobody can prove from the chain how, or whether, a
              voter voted. Masking a random voter gives them cover; masking your own slot covers your own activity.
            </p>
            {maskReceipt && running?.kind !== 'mask' && (
              <Notice tone="success">
                Mask submitted {formatDate(Math.floor(maskReceipt.at / 1000))}.
                <TxLink hash={maskReceipt.txHash} />
              </Notice>
            )}
            {running?.kind === 'mask' && <Progress kind="mask" progress={running.progress} />}
            {error?.kind === 'mask' && <Notice tone="error">{error.message}</Notice>}
            <div className="row">
              <button className="btn secondary sm" disabled={busy || poll.registrants === 0} onClick={() => mask('random')}>
                Mask a random voter
              </button>
              <button className="btn secondary sm" disabled={busy || !isRegistered} onClick={() => mask('self')}>
                Mask my own slot
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
