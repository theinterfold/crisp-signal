import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContracts, useWriteContract } from 'wagmi'
import { formatUnits, parseEventLogs, stringToHex, zeroAddress, type Address } from 'viem'
import { Plus, Trash } from '@phosphor-icons/react'
import { BOARD_ADDRESS, CHAIN, COMPUTE_PROVIDER_PARAMS, CRYPTO_CONFIG_ID, FAUCET_ADDRESS, INTERFOLD_ADDRESS, PARAM_SET } from '../config'
import { CountryPicker, MAX_COUNTRIES } from '../components/CountryPicker'
import { Notice } from '../components/PollBits'
import { crispSignalAbi, erc20Abi, faucetAbi, interfoldAbi } from '../lib/abi'
import { errorMessage, formatDuration, OPTION_COLORS } from '../lib/format'
import { uploadMetadata } from '../lib/ipfs'
import { MAX_OPTIONS, type PollMetadata } from '../lib/metadata'
import { NationalityRule } from '../lib/polls'
import { publicClient } from '../lib/wagmi'

const START_DELAYS = [
  { label: 'In 15 minutes', seconds: 15 * 60 },
  { label: 'In 1 hour', seconds: 3600 },
  { label: 'In 6 hours', seconds: 6 * 3600 },
  { label: 'Tomorrow', seconds: 86400 },
]
const DURATIONS = [3600, 6 * 3600, 86400, 3 * 86400, 7 * 86400]
const COMMITTEES = [
  { value: 0, label: 'Minimum', hint: 'Smallest committee, lowest fee.' },
  { value: 1, label: 'Micro', hint: 'More ciphernodes must collude to decrypt early.' },
]
/** Covers the quote moving between the preview and the transaction (time passes, the window shrinks). */
const FEE_SLACK_BPS = 200n

type Step = 'idle' | 'uploading' | 'approving' | 'creating'

const STEP_LABEL: Record<Step, string> = {
  idle: '',
  uploading: 'Publishing poll details to IPFS…',
  approving: 'Approve the fee token in your wallet…',
  creating: 'Confirm the poll in your wallet…',
}

function inputWindow(startDelay: number, duration: number): [bigint, bigint] {
  const start = Math.floor(Date.now() / 1000) + startDelay
  return [BigInt(start), BigInt(start + duration)]
}

/** What the board requests from: the E3 program it names and the token Interfold charges in. */
type Setup = { program: Address; feeToken: Address }

async function loadSetup(): Promise<Setup> {
  const [program, feeToken] = await Promise.all([
    publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAbi, functionName: 'CRISP_PROGRAM' }),
    publicClient.readContract({ address: INTERFOLD_ADDRESS, abi: interfoldAbi, functionName: 'feeToken' }),
  ])
  return { program, feeToken }
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
  const [startDelay, setStartDelay] = useState(START_DELAYS[0].seconds)
  const [duration, setDuration] = useState(DURATIONS[2])
  const [committeeSize, setCommitteeSize] = useState(0)

  const [minAge, setMinAge] = useState(18)
  const [rule, setRule] = useState(NationalityRule.Any)
  const [countries, setCountries] = useState<string[]>([])
  const [faceMatch, setFaceMatch] = useState(false)
  const [devMode, setDevMode] = useState(true)

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string>()
  const [metadataCid, setMetadataCid] = useState<{ cid: string; json: string }>()

  const setupRead = useQuery({ queryKey: ['setup'], queryFn: loadSetup, staleTime: Infinity })
  const setup = setupRead.data
  const feeToken = setup?.feeToken
  const token = useReadContracts({
    contracts: [
      { address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'symbol' },
      { address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'decimals' },
      { address: feeToken ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? zeroAddress] },
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
  const problems: string[] = []
  if (!title.trim()) problems.push('Give the poll a title.')
  if (trimmedOptions.some((o) => !o)) problems.push('Every option needs a label.')
  if (new Set(trimmedOptions).size !== trimmedOptions.length) problems.push('Options must be distinct.')
  if (rule !== NationalityRule.Any && countries.length === 0) problems.push('Pick at least one country, or allow any nationality.')
  if (rule === NationalityRule.Allow && devMode && !countries.includes('ZKR'))
    problems.push('Mock IDs carry the nationality ZKR: add "Zero Knowledge Republic" to the list, or turn off mock IDs.')

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
        maxFee,
        policy: {
          minAge,
          nationalityRule: rule,
          countries: rule === NationalityRule.Any ? [] : countries,
          faceMatch,
          devMode,
        },
      } as const
      const { request: simulated } = await publicClient.simulateContract({
        account: address,
        address: BOARD_ADDRESS,
        abi: crispSignalAbi,
        functionName: 'createPoll',
        args: [request],
      })
      const hash = await writeContractAsync(simulated)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The poll transaction reverted.')
      const [created] = parseEventLogs({ abi: crispSignalAbi, eventName: 'PollCreated', logs: receipt.logs })
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
              Voters prove these facts about their passport or national ID with ZKPassport. The poll contract checks the
              proof on-chain and admits each document once; it never learns who the voter is.
            </p>
            <div className="field">
              <label htmlFor="age">Minimum age</label>
              <div className="input-group">
                <input
                  id="age"
                  className="input"
                  type="number"
                  min={0}
                  max={120}
                  value={minAge}
                  onChange={(e) => setMinAge(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
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
                {[
                  [NationalityRule.Any, 'Any'],
                  [NationalityRule.Allow, 'Only these'],
                  [NationalityRule.Deny, 'All except'],
                ].map(([value, label]) => (
                  <button type="button" key={value} className={rule === value ? 'active' : ''} onClick={() => setRule(value as NationalityRule)}>
                    {label}
                  </button>
                ))}
              </div>
              {rule !== NationalityRule.Any && (
                <>
                  <span className="hint">
                    {rule === NationalityRule.Allow
                      ? 'Only nationals of the selected countries can vote.'
                      : 'Nationals of the selected countries cannot vote.'}{' '}
                    Up to {MAX_COUNTRIES} countries.
                  </span>
                  <CountryPicker value={countries} onChange={setCountries} />
                </>
              )}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={faceMatch} onChange={(e) => setFaceMatch(e.target.checked)} />
              <span>
                <strong>Require FaceMatch</strong>
                <span className="hint">The voter's face must match the document photo (strict mode) before the proof is produced.</span>
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} />
              <span>
                <strong>Accept ZKPassport mock IDs</strong>
                <span className="hint">
                  For demos and testing only: anyone can generate mock documents. Mock IDs are 18+ and of nationality ZKR.
                </span>
              </span>
            </label>
          </section>
        </div>

        <div>
          <section className="card stack">
            <h2>Schedule</h2>
            <div className="field">
              <label htmlFor="start">Voting opens</label>
              <select id="start" className="select" value={startDelay} onChange={(e) => setStartDelay(Number(e.target.value))}>
                {START_DELAYS.map((d) => (
                  <option key={d.seconds} value={d.seconds}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="hint">The committee needs about 20 minutes to generate the poll key.</span>
            </div>
            <div className="field">
              <label htmlFor="duration">Voting lasts</label>
              <select id="duration" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {formatDuration(d)}
                  </option>
                ))}
              </select>
            </div>
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
