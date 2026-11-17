import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ZKPASSPORT_DOMAIN } from '../config'
import { crispAztecProgramAbi } from '../lib/abi'
import { getClient, getSession, loadRound, loadZkPassportRequirements, slotKeys } from '../lib/aztec'
import { errorMessage } from '../lib/format'
import type { Poll } from '../lib/polls'
import { registerSlot } from '../lib/vote'
import { publicClient } from '../lib/wagmi'
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
 * The proof is bound to this browser's Aztec account (kept in localStorage), which sends the registration; the slot registered is
 * an EVM key made for this poll and kept next to it, so the account and the slot are not linked on chain.
 */
export function PassportStep({ poll, title, onRegistered }: { poll: Poll; title: string; onRegistered: () => void }) {
  const queryClient = useQueryClient()
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

  async function register(proof: ProofSummary) {
    setStatus('registering')
    // The phone is still told the verdict: hide the code, and cancel the request once the registration is over.
    setRequest(undefined)
    try {
      await registerSlot({ e3Id: poll.e3Id, proof: proof.result })
      reset()
      setStatus('idle')
      await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
      await queryClient.invalidateQueries({ queryKey: ['polls'] })
      onRegistered()
    } catch (e) {
      console.error('Registration failed', e)
      fail(`${errorMessage(e)} (ZKPassport proof ${proof.name ?? 'unnamed'}, circuits ${proof.version ?? 'unknown'})`)
    }
  }

  async function start() {
    setError(undefined)
    setStatus('opening')
    try {
      const round = await loadRound(poll.e3Id)
      if (!round.opened) throw new Error('The round is not open on Aztec yet: the keeper has not relayed it from Ethereum. Try again in a few minutes.')

      const [session, client, scope] = await Promise.all([
        getSession(),
        getClient(),
        publicClient.readContract({ address: poll.program, abi: crispAztecProgramAbi, functionName: 'scopeOf', args: [poll.e3Id] }),
      ])
      const requirements = await loadZkPassportRequirements(client)
      // Made before anything is registered with it, so a crash cannot orphan a registration.
      slotKeys.getOrCreate(poll.e3Id)

      const opened = await requestPassportProof(
        {
          domain: ZKPASSPORT_DOMAIN,
          scope,
          minAge: poll.minAge,
          devMode: poll.allowMockDocuments,
          validitySeconds: requirements.validitySeconds,
          aztecAddress: session.address.toString(),
          purpose: `Check you are eligible to vote in "${title}"`,
          expected: { circuitsVersion: requirements.circuitsVersion },
        },
        {
          onScanned: () => setStatus('scanned'),
          onProving: () => setStatus('proving'),
          onProof: (proof) => {
            // Answer the phone at once: the registration takes minutes, and the chain, not this page, verifies the proof.
            void register(proof)
            return true
          },
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

  return (
    <div className="stack" style={{ gap: 12 }}>
      {request && status !== 'registering' && (
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
      {error && <Notice tone="error">{error}</Notice>}
      {!busy && (
        <button className="btn block" onClick={start}>
          Verify with ZKPassport
        </button>
      )}
      {busy && status !== 'registering' && (
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
