import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContracts, useWriteContract } from 'wagmi'
import { formatUnits, parseEventLogs, stringToHex, zeroAddress, type Address } from 'viem'
import { Plus, Trash } from '@phosphor-icons/react'
import { BOARD_ADDRESS, CHAIN, COMPUTE_PROVIDER_PARAMS, CRYPTO_CONFIG_ID, FAUCET_ADDRESS, INTERFOLD_ADDRESS, PARAM_SET } from '../config'
import { CountryPicker, MAX_COUNTRIES } from '../components/CountryPicker'
import { Notice } from '../components/PollBits'
import { ciphernodeRegistryAbi, crispAztecProgramAbi, crispSignalAztecAbi, erc20Abi, faucetAbi, interfoldAbi } from '../lib/abi'
import { errorMessage, formatDuration, OPTION_COLORS } from '../lib/format'
import { DurationInput } from '../components/DurationInput'
import { loadSdk } from '../lib/aztec'
import { uploadMetadata } from '../lib/ipfs'
import { MAX_OPTIONS, type PollMetadata } from '../lib/metadata'
import { NationalityMode } from '../lib/polls'
import { publicClient } from '../lib/chain'

const MINUTE = 60
const DAY = 86400
/** Voting shorter than this leaves no time to prove and submit a ballot. */
const MIN_DURATION = 5 * MINUTE
/** What follows the close of voting before results: Aztec's epoch proof, the root's trip to Ethereum, the compute, the decryption. */
const RESULT_DELAY = '1–2 hours'
/** Time between filling in the form and the transaction landing, kept free under the network's cap. */
const SUBMIT_SLACK = 10 * MINUTE
/** `CRISPRemoteProgram` caps the age rule here. */
const MAX_AGE = 99
/** Mock ZKPassport documents carry this nationality. */
const MOCK_NATIONALITY = 'ZKR'
type Registration = 'l1' | 'aztec'
const REGISTRATIONS: { value: Registration; title: string; badge: string; body: string }[] = [
  {
    value: 'l1',
    title: 'On Ethereum',
    badge: 'Works with the ZKPassport app today',
    body: 'Voters scan with the ZKPassport app; the CRISP server submits their proof to a ZKPassport verifier on Ethereum, and a keeper carries each registration to Aztec, a few minutes later. Ballots are still cast on Aztec.',
  },
  {
    value: 'aztec',
    title: 'On Aztec',
    badge: 'Needs a bb-6 ZKPassport app',
    body: "Voters' browsers prove their registration straight into the Aztec contract. Aztec 6 only verifies proofs made with the bb 6 prover, which today's ZKPassport app does not produce yet, so registration fails until it does.",
  },
]

const COMMITTEES = [
  { value: 0, label: 'Minimum', hint: 'Smallest committee, lowest fee.' },
  { value: 1, label: 'Micro', hint: 'More ciphernodes must collude to decrypt early.' },
]
/** Covers the quote moving between the preview and the transaction (time passes, the window shrinks). */
const FEE_SLACK_BPS = 200n

type Step = 'idle' | 'uploading' | 'committing' | 'approving' | 'creating'

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  uploading: 'Publishing poll details to IPFS…',
  committing: 'Computing the commitment to the country list…',
  approving: 'Approve the fee token in your wallet…',
  creating: 'Confirm the poll in your wallet…',
}

function inputWindow(startDelay: number, duration: number): [bigint, bigint] {
  const start = Math.floor(Date.now() / 1000) + startDelay
  return [BigInt(start), BigInt(start + duration)]
}

const when = (offsetSeconds: number) =>
  new Date(Date.now() + offsetSeconds * 1000).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * What the board requests from: the E3 program it names and the token Interfold charges in, plus
 * the network's timing rules.
 * - `keyReservation`: the worst case from request to published committee key.
 * - `maxSpan`: the latest the window may close, counted from the request. Interfold rejects a round
 *   whose close plus the compute and decryption windows exceeds `maxDuration`.
 */
type Setup = {
  program: Address
  feeToken: Address
  keyReservation: number
  maxSpan: number
  /** The program's shortest voting window (zero turns the key-deadline and length checks off). */
  minVotingDuration: number
  /** Interfold's compute window must cover this: the time Aztec needs to deliver the input root. */
  remoteFinalityWindow: number
  computeWindow: number
}

async function loadSetup(): Promise<Setup> {
  const [program, feeToken, timeouts, maxDuration, registry] = await Promise.all([
    publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'CRISP_PROGRAM' }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'feeToken' }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'getTimeoutConfig' }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'maxDuration' }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'ciphernodeRegistry' }),
  ])
  const [randomness, sortition, minVotingDuration, remoteFinalityWindow] = await Promise.all([
    publicClient.readContract({ address: registry, abi: ciphernodeRegistryAbi, functionName: 'randomnessRequestTimeout' }),
    publicClient.readContract({ address: registry, abi: ciphernodeRegistryAbi, functionName: 'sortitionSubmissionWindow' }),
    publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'minVotingDuration' }),
    publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'remoteFinalityWindow' }),
  ])
  return {
    program,
    feeToken,
    keyReservation: Number(randomness + sortition + timeouts.dkgWindow),
    maxSpan: Number(maxDuration - timeouts.computeWindow - timeouts.decryptionWindow),
    minVotingDuration: Number(minVotingDuration),
    remoteFinalityWindow: Number(remoteFinalityWindow),
    computeWindow: Number(timeouts.computeWindow),
  }
}

async function quote({ program, feeToken }: Setup, committeeSize: number, window: [bigint, bigint]) {
  return publicClient.readContract({
    address: INTERFOLD_ADDRESS,
    abi: interfoldAbi,
    functionName: 'getE3Quote',
    args: [
      {
        committeeSize,
        inputWindow: window,
        e3Program: program,
        paramSet: PARAM_SET,
        computeProviderParams: '0x',
        customParams: '0x',
        expectedFeeToken: feeToken,
        expectedCryptoConfigId: CRYPTO_CONFIG_ID[PARAM_SET],
        maxFee: 0n,
      },
    ],
  })
}

export function CreatePollPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { address, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()

  const [title, setTitle] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(['Yes', 'No'])
  const [startDelay, setStartDelay] = useState(60 * MINUTE)
  const [duration, setDuration] = useState(DAY)
  const [committeeSize, setCommitteeSize] = useState(0)

  const [registration, setRegistration] = useState<Registration>('l1')
  const [minAge, setMinAge] = useState(18)
  const [nationalityMode, setNationalityMode] = useState<NationalityMode>(NationalityMode.None)
  const [countries, setCountries] = useState<string[]>([])
  const [allowMockDocuments, setAllowMockDocuments] = useState(true)

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string>()
  const [metadataCid, setMetadataCid] = useState<{ cid: string; json: string }>()

  const setupRead = useQuery({ queryKey: ['setup'], queryFn: loadSetup, staleTime: Infinity })
  const setup = setupRead.data
  const feeToken = setup?.feeToken
  // wagmi also lists mainnet (for ConnectKit's ENS lookups), so reads name the chain explicitly.
  const token = useReadContracts({
    contracts: [
      { chainId: CHAIN.id, address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'symbol' },
      { chainId: CHAIN.id, address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'decimals' },
      { chainId: CHAIN.id, address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? zeroAddress] },
    ],
    allowFailure: false,
    query: { enabled: Boolean(feeToken) },
  })
  const [symbol, decimals, balance] = token.data ?? []

  const fee = useQuery({
    queryKey: ['quote', committeeSize, startDelay, duration, setup],
    queryFn: () => quote(setup!, committeeSize, inputWindow(startDelay, duration)),
    enabled: Boolean(setup),
    refetchInterval: 30_000,
  })

  const amount = (v: bigint | undefined) => (v === undefined || decimals === undefined ? '…' : `${formatUnits(v, decimals)} ${symbol}`)

  const trimmedOptions = options.map((o) => o.trim())
  // The list the poll commits to; none when anyone may vote.
  const ruleCountries = nationalityMode === NationalityMode.None ? [] : countries
  const problems: string[] = []
  if (!title.trim()) problems.push('Give the poll a title.')
  if (trimmedOptions.some((o) => !o)) problems.push('Every option needs a label.')
  if (new Set(trimmedOptions).size !== trimmedOptions.length) problems.push('Options must be distinct.')
  if (nationalityMode !== NationalityMode.None && countries.length === 0) {
    problems.push('Pick at least one country, or allow any nationality.')
  }
  if (nationalityMode === NationalityMode.In && allowMockDocuments && !countries.includes(MOCK_NATIONALITY)) {
    problems.push('Mock IDs carry the nationality ZKR: add "Zero Knowledge Republic" to the list, or turn off mock IDs.')
  }
  if (setup && setup.computeWindow < setup.remoteFinalityWindow) {
    problems.push("The network gives computation less time than Aztec needs to deliver a poll's input root, so polls cannot be created.")
  }
  const minDuration = Math.max(MIN_DURATION, setup?.minVotingDuration ?? 0)
  // The program refuses a window that opens before the worst-case key setup has run out; the transaction lands a little after this page.
  const earliestStart = setup && setup.minVotingDuration > 0 ? setup.keyReservation + SUBMIT_SLACK : 0
  const latestClose = setup ? setup.maxSpan - SUBMIT_SLACK : undefined
  const timingProblem =
    startDelay < earliestStart
      ? `Voting must open at least ${formatDuration(earliestStart)} from now: the committee needs up to ${formatDuration(setup!.keyReservation)} to generate the poll's key.`
      : duration < minDuration
        ? `Voting must last at least ${formatDuration(minDuration)}.`
        : latestClose !== undefined && startDelay + duration > latestClose
          ? `The network caps a round: voting must close within ${formatDuration(latestClose)} of creating the poll.`
          : undefined
  if (timingProblem) problems.push(timingProblem)

  const insufficient = fee.data !== undefined && balance !== undefined && balance < fee.data

  async function faucet() {
    setError(undefined)
    try {
      const hash = await writeContractAsync({ address: FAUCET_ADDRESS, abi: faucetAbi, functionName: 'faucet' })
      await publicClient.waitForTransactionReceipt({ hash })
      await token.refetch()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!address || !setup || problems.length) return
    const { feeToken } = setup
    setError(undefined)
    try {
      const metadata: PollMetadata = {
        schema: 'crisp-signal/poll@1',
        title: title.trim(),
        description: description.trim(),
        organisation: organisation.trim(),
        options: trimmedOptions,
      }
      const json = JSON.stringify(metadata)
      let cid = metadataCid?.json === json ? metadataCid.cid : undefined
      if (!cid) {
        setStep('uploading')
        cid = await uploadMetadata(metadata)
        setMetadataCid({ cid, json })
      }

      // The Aztec contract verifies proofs against ZKPassport's commitment to the country list, which Ethereum cannot compute: the
      // creator supplies it, and voters' browsers recompute it from the list before they register. The Ethereum path checks the list itself.
      let nationalityCommitment = 0n
      if (registration === 'aztec' && nationalityMode !== NationalityMode.None) {
        setStep('committing')
        nationalityCommitment = await (await loadSdk()).nationalityCommitment(nationalityMode, ruleCountries)
      }

      // Quote the exact window the transaction will request, then allow a little drift.
      const window = inputWindow(startDelay, duration)
      const current = await quote(setup, committeeSize, window)
      const maxFee = current + (current * FEE_SLACK_BPS) / 10_000n

      const allowance = await publicClient.readContract({
        address: feeToken,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, BOARD_ADDRESS],
      })
      if (allowance < maxFee) {
        setStep('approving')
        const hash = await writeContractAsync({ address: feeToken, abi: erc20Abi, functionName: 'approve', args: [BOARD_ADDRESS, maxFee] })
        await publicClient.waitForTransactionReceipt({ hash })
      }

      setStep('creating')
      const request = {
        metadataCid: cid,
        numOptions: BigInt(trimmedOptions.length),
        inputWindow: window,
        committeeSize,
        paramSet: PARAM_SET,
        computeProviderParams: stringToHex(COMPUTE_PROVIDER_PARAMS),
        expectedCryptoConfigId: CRYPTO_CONFIG_ID[PARAM_SET],
        minAge: BigInt(minAge),
        allowMockDocuments,
        l1Registration: registration === 'l1',
        nationalityMode,
        countries: ruleCountries,
        nationalityCommitment,
        maxFee,
      } as const
      const { request: simulated } = await publicClient.simulateContract({
        account: address,
        address: BOARD_ADDRESS,
        abi: crispSignalAztecAbi,
        functionName: 'createPoll',
        args: [request],
      })
      const hash = await writeContractAsync(simulated)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The poll transaction reverted.')
      const [created] = parseEventLogs({ abi: crispSignalAztecAbi, eventName: 'PollCreated', logs: receipt.logs })
      await queryClient.invalidateQueries({ queryKey: ['polls'] })
      navigate(`/poll/${created.args.pollId}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setStep('idle')
    }
  }

  const busy = step !== 'idle'
  const wrongChain = address && chainId !== CHAIN.id

  return (
    <form onSubmit={submit}>
      <div className="page-head">
        <div>
          <span className="eyebrow">New poll</span>
          <h1 style={{ marginTop: 8 }}>Create a poll</h1>
          <p>
            The question and options are published to IPFS. The Interfold assigns a ciphernode committee that holds the
            decryption key; the ballots stay encrypted, and only the final tally is decrypted.
          </p>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <section className="card stack">
            <h2>Question</h2>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Should the network adopt proposal 12?" />
            </div>
            <div className="field">
              <label htmlFor="org">Organisation</label>
              <input id="org" className="input" maxLength={80} value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="field">
              <label htmlFor="desc">Description</label>
              <textarea id="desc" className="textarea" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context voters need before they answer." />
            </div>
            <div className="field">
              <span className="label">Options</span>
              <div className="stack" style={{ gap: 8 }}>
                {options.map((option, i) => (
                  <div className="option-input" key={i}>
                    <span className="swatch" style={{ background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
                    <input
                      className="input"
                      maxLength={80}
                      value={option}
                      aria-label={`Option ${i + 1}`}
                      onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                    />
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={options.length <= 2}
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {options.length < MAX_OPTIONS && (
                <button type="button" className="btn secondary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, ''])}>
                  <Plus size={14} weight="bold" /> Add option
                </button>
              )}
              <span className="hint">Between 2 and {MAX_OPTIONS} options. Each voter picks one.</span>
            </div>
          </section>

          <section className="card stack">
            <h2>Who can vote</h2>
            <p className="muted small">
              Voters prove these facts about their passport or national ID with ZKPassport. The proof is checked on-chain and
              admits each document once; it never reveals who the voter is. No Ethereum wallet is needed to vote.
            </p>
            <div className="field">
              <label htmlFor="age">Minimum age</label>
              <div className="input-group">
                <input
                  id="age"
                  className="input"
                  type="number"
                  min={0}
                  max={MAX_AGE}
                  value={minAge}
                  onChange={(e) => setMinAge(Math.max(0, Math.min(MAX_AGE, Number(e.target.value) || 0)))}
                  style={{ maxWidth: 120 }}
                />
                <span className="hint" style={{ alignSelf: 'center' }}>
                  {minAge === 0 ? 'No age requirement.' : `Voters must be ${minAge} or older.`}
                </span>
              </div>
            </div>
            <div className="field">
              <span className="label">Nationality</span>
              <div className="segmented" role="tablist">
                {(
                  [
                    [NationalityMode.None, 'Any'],
                    [NationalityMode.In, 'Only these'],
                    [NationalityMode.Out, 'All except'],
                  ] as const
                ).map(([value, label]) => (
                  <button type="button" key={value} className={nationalityMode === value ? 'active' : ''} onClick={() => setNationalityMode(value)}>
                    {label}
                  </button>
                ))}
              </div>
              {nationalityMode !== NationalityMode.None && (
                <>
                  <span className="hint">
                    {nationalityMode === NationalityMode.In
                      ? 'Only nationals of the selected countries can vote.'
                      : 'Nationals of the selected countries cannot vote.'}{' '}
                    Up to {MAX_COUNTRIES} countries.
                  </span>
                  <CountryPicker value={countries} onChange={setCountries} />
                </>
              )}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={allowMockDocuments} onChange={(e) => setAllowMockDocuments(e.target.checked)} />
              <span>
                <strong>Accept ZKPassport mock IDs</strong>
                <span className="hint">
                  For demos and testing only: anyone can generate mock documents. Mock IDs are 18+ and of nationality ZKR.
                </span>
              </span>
            </label>
          </section>

          <section className="card stack">
            <h2>How voters register</h2>
            <p className="muted small">
              Each poll registers its voters one way, never both, so a document can only ever register once. Ballots are cast on
              Aztec either way.
            </p>
            {REGISTRATIONS.map((r) => (
              <label className="toggle" key={r.value}>
                <input type="radio" name="registration" checked={registration === r.value} onChange={() => setRegistration(r.value)} />
                <span>
                  <strong>
                    {r.title} <span className="chip">{r.badge}</span>
                  </strong>
                  <span className="hint">{r.body}</span>
                </span>
              </label>
            ))}
          </section>
        </div>

        <div>
          <section className="card stack">
            <h2>Schedule</h2>
            <div className="field">
              <label htmlFor="start-days">Voting opens in</label>
              <DurationInput id="start" value={startDelay} onChange={setStartDelay} />
              <span className="hint">
                {setup && startDelay < setup.keyReservation
                  ? `Opens ${when(startDelay)}. The committee key can take up to ${formatDuration(setup.keyReservation)} (usually about 20 minutes); ballots are accepted once it is published.`
                  : `Opens ${when(startDelay)}. The committee generates the poll key before then.`}
              </span>
            </div>
            <div className="field">
              <label htmlFor="duration-days">Voting lasts</label>
              <DurationInput id="duration" value={duration} onChange={setDuration} />
              <span className={timingProblem ? 'hint error' : 'hint'}>
                {timingProblem ??
                  `Closes ${when(startDelay + duration)}.${latestClose !== undefined ? ` At most ${formatDuration(Math.max(0, latestClose - startDelay))} with this start.` : ''}`}
              </span>
            </div>
            <Notice>
              Results arrive {RESULT_DELAY} after voting closes: Aztec has to prove the epoch that holds the last ballot before the
              input root can reach Ethereum, and only then is the tally computed and decrypted.
            </Notice>
            <div className="field">
              <span className="label">Committee</span>
              <div className="segmented">
                {COMMITTEES.map((c) => (
                  <button type="button" key={c.value} className={committeeSize === c.value ? 'active' : ''} onClick={() => setCommitteeSize(c.value)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <span className="hint">{COMMITTEES[committeeSize].hint}</span>
            </div>
          </section>

          <section className="card stack">
            <div className="spread">
              <h2>Fee</h2>
              <span className="mono" style={{ fontSize: 20 }}>
                {fee.isPending ? '…' : fee.error ? '—' : amount(fee.data)}
              </span>
            </div>
            <p className="muted small">
              Paid once by the poll creator to the Interfold for the committee, compute and decryption. Refunded in part
              if the round fails.
            </p>
            {fee.error && <Notice tone="error">Could not quote the fee: {errorMessage(fee.error)}</Notice>}
            {setupRead.error && <Notice tone="error">Could not read the board: {errorMessage(setupRead.error)}</Notice>}
            {address && (
              <div className="stat-line">
                Your balance <strong>{amount(balance)}</strong>
              </div>
            )}
            {address && insufficient && (
              <Notice tone="warning">
                Not enough {symbol} for the fee.{' '}
                <button type="button" className="link-btn" onClick={faucet}>
                  Get test tokens from the faucet
                </button>
              </Notice>
            )}
            <hr className="divider" style={{ margin: '4px 0' }} />
            {!address && <Notice>Connect a wallet to create a poll.</Notice>}
            {wrongChain && <Notice tone="warning">Switch your wallet to {CHAIN.name}.</Notice>}
            {address && problems.length > 0 && (
              <Notice tone="warning">
                {problems.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <button
              type="submit"
              className="btn brand block"
              disabled={!address || Boolean(wrongChain) || busy || problems.length > 0 || insufficient || !fee.data}
            >
              {busy ? (
                <>
                  <span className="spinner" /> {STEP_LABEL[step]}
                </>
              ) : (
                'Publish poll'
              )}
            </button>
          </section>
        </div>
      </div>
    </form>
  )
}
