import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAddress, type Address, type Hex } from 'viem'
import { CHAIN, ZKPASSPORT_DOMAIN } from '../config'
import { crispAztecProgramAbi, zkPassportRegistrarAbi } from '../lib/abi'
import { assertServerRelaysTo, getClient, getSession, l1Registration, loadRound, loadZkPassportRequirements, slotKeys } from '../lib/aztec'
import { errorMessage, shortHex } from '../lib/format'
import { isL1Registration, useRulesCheck, type Poll } from '../lib/polls'
import { awaitL1Registration, registerSlot, registerSlotOnL1, type L1RegistrationStep } from '../lib/vote'
import { publicClient } from '../lib/wagmi'
import { requestPassportProof, type PassportRequest, type ProofSummary } from '../lib/zkpassport'
import { Notice } from './PollBits'

type Status = 'idle' | 'opening' | 'waiting' | 'scanned' | 'proving' | 'registering' | 'relaying' | L1RegistrationStep

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  opening: 'Preparing the request…',
  waiting: 'Scan the code with the ZKPassport app.',
  scanned: 'Request opened on your phone. Review it and accept.',
  proving: 'Your phone is generating the proof. This can take a minute.',
  registering: 'Registering on Aztec: your browser proves the transaction, about a minute. Keep this tab open.',
  relaying: 'Sending your proof to the CRISP server, which submits it to Ethereum for you. No wallet or gas needed.',
  confirming: 'Waiting for the registration transaction on Ethereum to confirm…',
  aztec: 'Registered on Ethereum. Waiting for the keeper to add you to the poll on Aztec: the registration crosses to Aztec as a message, which takes a few minutes. Your progress is saved, so you can close this tab.',
}

/** The phone has finished: nothing is left to scan, and the QR code goes away. */
const AFTER_PHONE: Status[] = ['registering', 'relaying', 'confirming', 'aztec']

/**
 * Proves eligibility with ZKPassport and registers the voter's slot in the poll's census on Aztec: one registration per document.
 *
 * Each poll registers on one of two paths, chosen by its creator. The slot registered is always an EVM key made for this poll and
 * kept in this browser, so nothing links the voter's account, document and slot on chain.
 * - Aztec: the proof is bound to this browser's Aztec account, which proves and sends `register` from the browser.
 * - Ethereum: the `compressed-evm` proof is bound to the slot and the chain; the CRISP server submits it to the poll's
 *   `ZKPassportRegistrar` and a keeper carries the slot to Aztec. The voter then waits for it to appear in the census.
 * Neither needs an Ethereum wallet.
 */
export function PassportStep({ poll, title, onRegistered }: { poll: Poll; title: string; onRegistered: () => void }) {
  const queryClient = useQueryClient()
  const { rules } = poll
  const l1 = isL1Registration(rules)
  const check = useRulesCheck(poll)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>()
  const [request, setRequest] = useState<PassportRequest>()
  const [l1Tx, setL1Tx] = useState<Hex | undefined>(() => (l1 ? l1Registration.get(poll.e3Id) : undefined))
  const requestRef = useRef<PassportRequest>()
  const followRef = useRef<AbortController>()

  useEffect(
    () => () => {
      requestRef.current?.cancel()
      followRef.current?.abort()
    },
    [],
  )

  // A reload while the registration crosses to Aztec: pick the wait up again instead of asking the voter to verify twice.
  useEffect(() => {
    const slotKey = slotKeys.get(poll.e3Id)
    const pending = l1 ? l1Registration.get(poll.e3Id) : undefined
    if (pending && slotKey) void follow(slotKeys.address(slotKey), pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function registerOnAztec(proof: ProofSummary) {
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

  /** Waits for a registration already on Ethereum to reach the Aztec census. */
  async function follow(slot: Address, txHash: Hex) {
    followRef.current?.abort()
    const controller = new AbortController()
    followRef.current = controller
    setError(undefined)
    setStatus('confirming')
    setL1Tx(txHash)
    try {
      await awaitL1Registration({ e3Id: poll.e3Id, slot, txHash, onStep: setStatus, signal: controller.signal })
      setL1Tx(undefined)
      await finished()
    } catch (e) {
      if (controller.signal.aborted) return
      console.error('Registration failed', e)
      setL1Tx(l1Registration.get(poll.e3Id))
      fail(errorMessage(e))
    }
  }

  async function registerOnL1(params: Parameters<typeof registerSlotOnL1>[0]['params']) {
    setStatus('relaying')
    setRequest(undefined)
    try {
      const { slot, txHash } = await registerSlotOnL1({ e3Id: poll.e3Id, countries: rules.countries, params })
      reset()
      await follow(slot, txHash)
    } catch (e) {
      console.error('Registration failed', e)
      fail(errorMessage(e))
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
      const slot = slotKeys.address(slotKeys.getOrCreate(poll.e3Id))
      const purpose = `Check you are eligible to vote in "${title}"`
      const events = {
        onScanned: () => setStatus('scanned'),
        onProving: () => setStatus('proving'),
        onRejected: () => fail('The request was declined in the ZKPassport app.'),
        onError: fail,
      }

      let opened: PassportRequest
      if (l1) {
        const registrar = getAddress(rules.registrar)
        const [program, domain, validity] = await Promise.all([
          publicClient.readContract({ address: registrar, abi: zkPassportRegistrarAbi, functionName: 'program' }),
          publicClient.readContract({ address: registrar, abi: zkPassportRegistrarAbi, functionName: 'domain' }),
          publicClient.readContract({ address: registrar, abi: zkPassportRegistrarAbi, functionName: 'validityPeriod' }),
          assertServerRelaysTo(registrar),
        ])
        if (program !== poll.program) throw new Error(`This poll's registrar belongs to program ${program}, not ${poll.program}.`)
        opened = await requestPassportProof(
          {
            domain,
            scope,
            rules,
            validitySeconds: Number(validity),
            purpose,
            target: {
              path: 'l1',
              slot,
              onProof: (params) => {
                // Answer the phone at once: the registration takes minutes, and the chain, not this page, verifies the proof.
                void registerOnL1(params)
                return true
              },
            },
          },
          events,
        )
      } else {
        const [session, client] = await Promise.all([getSession(), getClient()])
        const requirements = await loadZkPassportRequirements(client)
        opened = await requestPassportProof(
          {
            domain: ZKPASSPORT_DOMAIN,
            scope,
            rules,
            validitySeconds: requirements.validitySeconds,
            purpose,
            target: {
              path: 'aztec',
              aztecAddress: session.address.toString(),
              expected: { circuitsVersion: requirements.circuitsVersion },
              onProof: (proof) => {
                void registerOnAztec(proof)
                return true
              },
            },
          },
          events,
        )
      }
      requestRef.current = opened
      setRequest(opened)
      setStatus('waiting')
    } catch (e) {
      console.error('Could not start the ZKPassport request', e)
      fail(errorMessage(e))
    }
  }

  const busy = status !== 'idle'
  const afterPhone = AFTER_PHONE.includes(status)
  const rulesVerdict = check.data
  const blocked = rulesVerdict && !rulesVerdict.ok ? rulesVerdict.reason : undefined

  return (
    <div className="stack" style={{ gap: 12 }}>
      {request && !afterPhone && (
        <div className="qr">
          <img src={request.qr} alt="ZKPassport request QR code" />
          <a className="small" href={request.url} target="_blank" rel="noreferrer">
            On your phone? Open in ZKPassport
          </a>
        </div>
      )}
      {busy && (
        <div className="row small">
          <span className="spinner" /> {status === 'opening' && !l1 ? 'Preparing your Aztec account and the prover…' : STATUS_TEXT[status]}
        </div>
      )}
      {l1Tx && afterPhone && (
        <p className="muted small">
          Ethereum transaction{' '}
          <a className="mono" href={`${CHAIN.blockExplorers.default.url}/tx/${l1Tx}`} target="_blank" rel="noreferrer" title={l1Tx}>
            {shortHex(l1Tx)}
          </a>
        </p>
      )}
      {blocked && <Notice tone="error">{blocked} Do not register for this poll.</Notice>}
      {check.error && <Notice tone="warning">Could not check the poll's nationality rule: {errorMessage(check.error)}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!busy && (
        <button className="btn block" disabled={!rulesVerdict?.ok} onClick={start}>
          Verify with ZKPassport
        </button>
      )}
      {busy && !afterPhone && (
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
