import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ZKPASSPORT_DOMAIN } from '../config'
import { crispAztecProgramAbi } from '../lib/abi'
import { getClient, getSession, loadRound, loadZkPassportRequirements, slotKeys } from '../lib/aztec'
import { errorMessage } from '../lib/format'
import { useRulesCheck, type Poll } from '../lib/polls'
import { registerSlot } from '../lib/vote'
import { publicClient } from '../lib/chain'
import { requestPassportProof, type PassportRequest, type ProofSummary } from '../lib/zkpassport'
import { Notice } from './PollBits'

type Status = 'idle' | 'opening' | 'waiting' | 'scanned' | 'proving' | 'registering'

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  opening: 'Preparing your Aztec account and the prover…',
  waiting: 'Scan the code with the ZKPassport app.',
  scanned: 'Request opened on your phone. Review it and accept.',
  proving: 'Your phone is generating the proof. This can take a minute.',
  registering: 'Registering on Aztec: your browser proves the transaction, about a minute. Keep this tab open.',
}

/**
 * Proves eligibility with ZKPassport and registers the voter's slot in the poll's census on Aztec: one registration per document.
 *
 * The `compressed` proof is bound to this browser's Aztec account, which proves and sends `register` from the browser; no
 * Ethereum wallet is needed. The slot registered is an EVM key made for this poll and kept in this browser, so nothing links the
 * voter's account, document and slot on chain.
 */
export function PassportStep({ poll, title, onRegistered }: { poll: Poll; title: string; onRegistered: () => void }) {
  const queryClient = useQueryClient()
  const { rules } = poll
  const check = useRulesCheck(poll)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>()
  const [request, setRequest] = useState<PassportRequest>()
  const requestRef = useRef<PassportRequest>()

  useEffect(() => () => requestRef.current?.cancel(), [])

  function reset() {
    requestRef.current?.cancel()
    requestRef.current = undefined
    setRequest(undefined)
  }

  function fail(message: string) {
    reset()
    setStatus('idle')
    setError(message)
  }

  async function finished() {
    reset()
    setStatus('idle')
    await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
    await queryClient.invalidateQueries({ queryKey: ['polls'] })
    onRegistered()
  }

  async function register(proof: ProofSummary) {
    setStatus('registering')
    // The phone is still told the verdict: hide the code, and cancel the request once the registration is over.
    setRequest(undefined)
    try {
      await registerSlot({ e3Id: poll.e3Id, proof: proof.result })
      await finished()
    } catch (e) {
      console.error('Registration failed', e)
      fail(`${errorMessage(e)} (ZKPassport proof ${proof.name ?? 'unnamed'}, circuits ${proof.version ?? 'unknown'})`)
    }
  }

  async function start() {
    setError(undefined)
    setStatus('opening')
    try {
      const aztecRound = await loadRound(poll.e3Id)
      if (!aztecRound.opened) throw new Error('The round is not open on Aztec yet: the keeper has not relayed it from Ethereum. Try again in a few minutes.')

      const scope = await publicClient.readContract({ address: poll.program, abi: crispAztecProgramAbi, functionName: 'scopeOf', args: [poll.e3Id] })
      // Made before anything is registered with it, so a crash cannot orphan a registration.
      slotKeys.getOrCreate(poll.e3Id)
      const [session, client] = await Promise.all([getSession(), getClient()])
      const requirements = await loadZkPassportRequirements(client)
      const opened = await requestPassportProof(
        {
          domain: ZKPASSPORT_DOMAIN,
          scope,
          rules,
          validitySeconds: requirements.validitySeconds,
          purpose: `Check you are eligible to vote in "${title}"`,
          aztecAddress: session.address.toString(),
          expected: { circuitsVersion: requirements.circuitsVersion },
          onProof: (proof) => {
            void register(proof)
            return true
          },
        },
        {
          onScanned: () => setStatus('scanned'),
          onProving: () => setStatus('proving'),
          onRejected: () => fail('The request was declined in the ZKPassport app.'),
          onError: fail,
        },
      )
      requestRef.current = opened
      setRequest(opened)
      setStatus('waiting')
    } catch (e) {
      console.error('Could not start the ZKPassport request', e)
      fail(errorMessage(e))
    }
  }

  const busy = status !== 'idle'
  const registering = status === 'registering'
  const rulesVerdict = check.data
  const blocked = rulesVerdict && !rulesVerdict.ok ? rulesVerdict.reason : undefined

  return (
    <div className="stack" style={{ gap: 12 }}>
      {request && !registering && (
        <div className="qr">
          <img src={request.qr} alt="ZKPassport request QR code" />
          <a className="small" href={request.url} target="_blank" rel="noreferrer">
            On your phone? Open in ZKPassport
          </a>
        </div>
      )}
      {busy && (
        <div className="row small">
          <span className="spinner" /> {STATUS_TEXT[status]}
        </div>
      )}
      {blocked && <Notice tone="error">{blocked} Do not register for this poll.</Notice>}
      {check.error && <Notice tone="warning">Could not check the poll's nationality rule: {errorMessage(check.error)}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!busy && (
        <button className="btn block" disabled={!rulesVerdict?.ok} onClick={start}>
          Verify with ZKPassport
        </button>
      )}
      {busy && !registering && (
        <button
          className="btn ghost sm"
          onClick={() => {
            reset()
            setStatus('idle')
          }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
