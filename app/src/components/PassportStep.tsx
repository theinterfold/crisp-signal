import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWriteContract } from 'wagmi'
import type { Address } from 'viem'
import { passportRegistryAbi } from '../lib/abi'
import { errorMessage } from '../lib/format'
import type { Poll } from '../lib/polls'
import { publicClient } from '../lib/wagmi'
import { requestPassportProof, type PassportRequest, type RegisterParams } from '../lib/zkpassport'
import { Notice } from './PollBits'

type Status = 'idle' | 'opening' | 'waiting' | 'scanned' | 'proving' | 'registering'

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  opening: 'Preparing the request…',
  waiting: 'Scan the code with the ZKPassport app.',
  scanned: 'Request opened on your phone. Review it and accept.',
  proving: 'Your phone is generating the proof. This can take a minute.',
  registering: 'Confirm the registration transaction in your wallet…',
}

/**
 * Proves eligibility with ZKPassport and registers the voter's address in the poll's registry,
 * which is the CRISP census: one registration, one vote.
 */
export function PassportStep({ poll, account, title }: { poll: Poll; account: Address; title: string }) {
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
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

  async function register(params: RegisterParams) {
    setStatus('registering')
    try {
      const { request: simulated } = await publicClient.simulateContract({
        account,
        address: poll.registry,
        abi: passportRegistryAbi,
        functionName: 'register',
        args: [params],
      })
      const hash = await writeContractAsync(simulated)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The registration transaction reverted.')
      reset()
      setStatus('idle')
      await queryClient.invalidateQueries({ queryKey: ['registered', poll.registry] })
      await queryClient.invalidateQueries({ queryKey: ['poll', poll.id.toString()] })
    } catch (e) {
      reset()
      setStatus('idle')
      setError(errorMessage(e))
      // A false verdict shows the error state in ZKPassport's own UI.
      return false
    }
  }

  async function start() {
    setError(undefined)
    setStatus('opening')
    try {
      const [domain, scope] = await Promise.all([
        publicClient.readContract({ address: poll.registry, abi: passportRegistryAbi, functionName: 'domain' }),
        publicClient.readContract({ address: poll.registry, abi: passportRegistryAbi, functionName: 'scope' }),
      ])
      const opened = await requestPassportProof(
        { domain, scope, policy: poll.policy, account, purpose: `Check you are eligible to vote in "${title}"` },
        {
          onScanned: () => setStatus('scanned'),
          onProving: () => setStatus('proving'),
          onProof: register,
          onRejected: () => {
            reset()
            setStatus('idle')
            setError('The request was declined in the ZKPassport app.')
          },
          onError: (message) => {
            reset()
            setStatus('idle')
            setError(message)
          },
        },
      )
      requestRef.current = opened
      setRequest(opened)
      setStatus('waiting')
    } catch (e) {
      setStatus('idle')
      setError(errorMessage(e))
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
