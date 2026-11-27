import type { AztecNode } from '@aztec-labs/stdlib/interfaces/client'
import type * as SdkModule from '@crisp-e3/aztec'
import type * as CrispSdkModule from '@crisp-e3/sdk'
import type * as PassportModule from '@crisp-e3/aztec/passport'
import type { CrispAztec } from '@crisp-e3/aztec/passport'
import type { AztecSession, InputCommitted, MemberRegistered, RoundClosed, RoundOpened, KeyPublished, WithOrigin } from '@crisp-e3/aztec'
import { useQuery } from '@tanstack/react-query'
import { getAddress, hexToBigInt, isAddress, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { AZTEC_NODE_URL, BOARD_ADDRESS, CRISP_SERVER_URL } from '../config'
import { crispAztecProgramAbi, crispSignalAztecAbi } from './abi'
import { publicClient } from './chain'
import { unpackCircuitsVersion } from './zkpassport'

/*
 * Everything that talks to Aztec. The Aztec stack (PXE, wallet, prover, the contract artifact) is several MB of
 * JavaScript and wasm, so it is imported dynamically: the poll list and the poll page load without it, and only
 * reading a round's logs, registering or casting pull it in.
 */

export type { AztecSession, CrispAztec }

let sdkPromise: Promise<typeof SdkModule> | undefined
/** Dynamic on purpose: keeps the Aztec stack out of the initial bundle. */
export const loadSdk = () => (sdkPromise ??= import('@crisp-e3/aztec'))

let passportPromise: Promise<typeof PassportModule> | undefined
/** The ZKPassport round client (`CrispAztec`, `nationalityCommitment`): the only entry that loads `@zkpassport/*`. */
export const loadPassportSdk = () => (passportPromise ??= import('@crisp-e3/aztec/passport'))

let crispSdkPromise: Promise<typeof CrispSdkModule> | undefined
/** The CRISP SDK (encryption, the base proofs, bb.js), dynamic for the same reason: only the poll page's voting flows need it. */
export const loadCrispSdk = () => (crispSdkPromise ??= import('@crisp-e3/sdk'))

// ---------------------------------------------------------------------------------------------------------------
// Deployment, resolved from L1: the board names the CRISP program, and the program names its Aztec contract.
// ---------------------------------------------------------------------------------------------------------------

export type Deployment = {
  program: Address
  interfold: Address
  /** The `crisp_aztec` contract, 32 bytes hex. */
  aztecContract: Hex
}

let deploymentPromise: Promise<Deployment> | undefined

/** The L1 program the board requests rounds from, and the Aztec contract that program is wired to. */
export function loadDeployment(): Promise<Deployment> {
  deploymentPromise ??= (async () => {
    const program = await publicClient.readContract({ address: BOARD_ADDRESS, abi: crispSignalAztecAbi, functionName: 'CRISP_PROGRAM' })
    const [interfold, l2Program] = await Promise.all([
      publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'interfold' }),
      publicClient.readContract({ address: program, abi: crispAztecProgramAbi, functionName: 'l2Program' }),
    ])
    if (hexToBigInt(l2Program) === 0n) throw new Error('The CRISP program on Ethereum is not wired to an Aztec contract yet.')
    return { program, interfold, aztecContract: l2Program }
  })()
  deploymentPromise.catch(() => (deploymentPromise = undefined))
  return deploymentPromise
}

export const useDeployment = () => useQuery({ queryKey: ['deployment'], queryFn: loadDeployment, staleTime: Infinity })

// ---------------------------------------------------------------------------------------------------------------
// Reading a round from Aztec's public logs (no wallet involved)
// ---------------------------------------------------------------------------------------------------------------

let nodePromise: Promise<AztecNode> | undefined
export function getNode(): Promise<AztecNode> {
  // Dynamic on purpose: keeps the Aztec stack out of the initial bundle.
  nodePromise ??= import('@aztec-labs/aztec.js/node').then(({ createAztecNodeClient }) => createAztecNodeClient(AZTEC_NODE_URL))
  return nodePromise
}

/** The public logs of the `crisp_aztec` contract, by kind, with the block each was emitted in. */
export type RoundLogs = {
  RoundOpened: WithOrigin<RoundOpened>[]
  KeyPublished: WithOrigin<KeyPublished>[]
  MemberRegistered: WithOrigin<MemberRegistered>[]
  InputCommitted: WithOrigin<InputCommitted>[]
  RoundClosed: WithOrigin<RoundClosed>[]
}

/** The log queries are by tag and return every round's, so one fetch serves every poll for a few seconds. */
const LOG_TTL_MS = 8_000
let logsCache: { at: number; value: Promise<RoundLogs> } | undefined

export function loadLogs(): Promise<RoundLogs> {
  if (logsCache && Date.now() - logsCache.at < LOG_TTL_MS) return logsCache.value
  const value = (async () => {
    const [{ readLogs }, node, { aztecContract, interfold }] = await Promise.all([loadSdk(), getNode(), loadDeployment()])
    const { AztecAddress } = await import('@aztec-labs/aztec.js/addresses')
    const contract = AztecAddress.fromStringUnsafe(aztecContract)
    const [opened, keyPublished, registered, inputs, closed] = await Promise.all([
      readLogs(node, contract, 'RoundOpened', interfold),
      readLogs(node, contract, 'KeyPublished', interfold),
      readLogs(node, contract, 'MemberRegistered', interfold),
      readLogs(node, contract, 'InputCommitted', interfold),
      readLogs(node, contract, 'RoundClosed', interfold),
    ])
    return { RoundOpened: opened, KeyPublished: keyPublished, MemberRegistered: registered, InputCommitted: inputs, RoundClosed: closed }
  })()
  logsCache = { at: Date.now(), value }
  value.catch(() => {
    if (logsCache?.value === value) logsCache = undefined
  })
  return value
}

/** The Aztec transactions behind a round's logs, for linking to an explorer. Both lists are in the order of `members` / commit index. */
export type RoundTxs = {
  opened?: string
  keyPublished?: string
  closed?: string
  /** The transaction that registered each census member, parallel to `AztecRound.members`. */
  members: string[]
  /** The transaction of every input (vote, re-vote, mask) committed, by commit index. */
  inputs: string[]
}

export type AztecRound = {
  opened: boolean
  /** The committee key has reached the Aztec contract: ballots can be cast. */
  keyPublished: boolean
  closed: boolean
  /** Census members, registration order. */
  members: Address[]
  inputs: number
  txs: RoundTxs
  logs: RoundLogs
}

export async function loadRound(e3Id: bigint): Promise<AztecRound> {
  const logs = await loadLogs()
  const mine = <T extends { e3Id: bigint }>(list: T[]) => list.filter((log) => log.e3Id === e3Id)
  const registered = mine(logs.MemberRegistered).sort((a, b) => a.censusIndex - b.censusIndex)
  const committed = mine(logs.InputCommitted).sort((a, b) => a.index - b.index)
  const [opened] = mine(logs.RoundOpened)
  const [keyPublished] = mine(logs.KeyPublished)
  const [closed] = mine(logs.RoundClosed)
  return {
    opened: opened !== undefined,
    keyPublished: keyPublished !== undefined,
    closed: closed !== undefined,
    members: registered.map((log) => log.slot),
    inputs: committed.length,
    txs: {
      opened: opened?.origin.txHash,
      keyPublished: keyPublished?.origin.txHash,
      closed: closed?.origin.txHash,
      members: registered.map((log) => log.origin.txHash),
      inputs: committed.map((log) => log.origin.txHash),
    },
    logs,
  }
}

export const invalidateLogs = () => {
  logsCache = undefined
}

// ---------------------------------------------------------------------------------------------------------------
// Browser-persisted secrets: one Aztec account, and one EVM "slot" key per poll
// ---------------------------------------------------------------------------------------------------------------

const ACCOUNT_KEY = 'crisp-signal:aztec-account:v1'
const slotKeyKey = (e3Id: bigint) => `crisp-signal:slot-key:v1:${e3Id}`

type StoredAccount = { secret: Hex; salt: Hex; signingKey: Hex }

/**
 * The voter's slot: an EVM key made for one poll and kept in this browser. It is registered in the poll's census (never
 * linked to the Aztec account or the document) and signs the ballot. Lose the key and the registration cannot vote.
 */
export const slotKeys = {
  get: (e3Id: bigint): Hex | undefined => {
    const stored = localStorage.getItem(slotKeyKey(e3Id))
    return stored && /^0x[0-9a-fA-F]{64}$/.test(stored) ? (stored as Hex) : undefined
  },
  /** Makes and stores the poll's key before anything is registered with it, so a crash cannot orphan a registration. */
  getOrCreate: (e3Id: bigint): Hex => {
    const existing = slotKeys.get(e3Id)
    if (existing) return existing
    const key = generatePrivateKey()
    localStorage.setItem(slotKeyKey(e3Id), key)
    return key
  },
  address: (key: Hex): Address => privateKeyToAddress(key),
}

/** Every secret this browser holds for the app, as JSON the voter can keep. */
export function exportSecrets(): string {
  const slots: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)
    if (name?.startsWith('crisp-signal:slot-key:v1:')) slots[name.slice('crisp-signal:slot-key:v1:'.length)] = localStorage.getItem(name)!
  }
  return JSON.stringify({ aztecAccount: JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null'), slotKeys: slots }, null, 2)
}

// ---------------------------------------------------------------------------------------------------------------
// The Aztec session: an embedded wallet with this browser's account, proving client-side, fees paid by the SponsoredFPC
// ---------------------------------------------------------------------------------------------------------------

let sessionPromise: Promise<AztecSession> | undefined

/**
 * One wallet per page: `connectAztec` of the SDK, except that the account's keys come from (and go to) localStorage, so a
 * voter keeps one Aztec address across visits. The account is initializerless: nothing is deployed and nothing is paid.
 * Transactions are proved in the browser (`proverEnabled`); a public network rejects unproven ones.
 */
export function getSession(): Promise<AztecSession> {
  sessionPromise ??= createSession()
  sessionPromise.catch(() => (sessionPromise = undefined))
  return sessionPromise
}

async function createSession(): Promise<AztecSession> {
  const [{ createAztecNodeClient }, { SponsoredFeePaymentMethod }, { getContractInstanceFromInstantiationParams }, { Fq, Fr }, { SPONSORED_FPC_SALT }, { SponsoredFPCContract }, { EmbeddedWallet }, { openTmpStore }] =
    await Promise.all([
      import('@aztec-labs/aztec.js/node'),
      import('@aztec-labs/aztec.js/fee'),
      import('@aztec-labs/aztec.js/contracts'),
      import('@aztec-labs/foundation/curves/bn254'),
      import('@aztec-labs/constants'),
      import('@aztec-labs/noir-contracts.js/SponsoredFPC'),
      import('@aztec-labs/wallets/embedded'),
      import('@aztec-labs/kv-store/sqlite-opfs'),
    ])

  const node = createAztecNodeClient(AZTEC_NODE_URL)
  // `ephemeral` covers only the wallet DB: in the browser the PXE still opens the origin's persistent OPFS store, which
  // one tab at a time may hold, so a second tab of the app could not create a session. An in-memory store per page.
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true, pxe: { proverEnabled: true, store: await openTmpStore(true) } })
  try {
    let stored: StoredAccount | undefined
    try {
      stored = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') ?? undefined
    } catch {
      stored = undefined
    }
    if (!stored) {
      stored = { secret: Fr.random().toString(), salt: Fr.random().toString(), signingKey: Fq.random().toString() }
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(stored))
    }
    const account = await wallet.createSchnorrInitializerlessAccount(
      Fr.fromHexString(stored.secret),
      Fr.fromHexString(stored.salt),
      Fq.fromHexString(stored.signingKey),
    )
    const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
    await wallet.registerContract(fpc, SponsoredFPCContract.artifact)

    return {
      node,
      wallet,
      address: account.address,
      fee: { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) },
      rollupVersion: await node.getVersion(),
      l1ChainId: await node.getChainId(),
      stop: () => wallet.stop(),
    }
  } catch (error) {
    await wallet.stop()
    throw error
  }
}

let clientPromise: Promise<CrispAztec> | undefined

/** The `crisp_aztec` contract as a voter's session calls it. */
export function getClient(): Promise<CrispAztec> {
  clientPromise ??= (async () => {
    const [{ CrispAztec }, session, { aztecContract }] = await Promise.all([loadPassportSdk(), getSession(), loadDeployment()])
    return CrispAztec.connect(session, aztecContract)
  })()
  clientPromise.catch(() => (clientPromise = undefined))
  return clientPromise
}

// ---------------------------------------------------------------------------------------------------------------
// The CRISP server in Aztec mode
// ---------------------------------------------------------------------------------------------------------------

/** What the server is wired to; the voter relies on it for the availability signer, so it is checked against L1. */
export async function loadServerConfig() {
  const [{ getRemoteInputConfig }, deployment] = await Promise.all([loadSdk(), loadDeployment()])
  const config = await getRemoteInputConfig(CRISP_SERVER_URL)
  if (config.kind !== 'aztec') throw new Error(`The CRISP server at ${CRISP_SERVER_URL} runs rounds of kind "${config.kind}", not Aztec.`)
  if (!isAddress(config.program) || getAddress(config.program) !== deployment.program) {
    throw new Error(`The CRISP server serves program ${config.program}, but this app's board requests rounds from ${deployment.program}.`)
  }
  if (hexToBigInt(config.aztec_contract) !== hexToBigInt(deployment.aztecContract)) {
    throw new Error('The CRISP server is wired to a different Aztec contract than the CRISP program on Ethereum.')
  }
  return config
}

/** What the contract verifies registrations against: the ZKPassport circuits release and the proof validity window. */
export type ZkPassportRequirements = { circuitsVersion: string; validitySeconds: number }

export async function loadZkPassportRequirements(client: CrispAztec): Promise<ZkPassportRequirements> {
  const { result } = await client.contract.methods.get_config().simulate({ from: client.session.address })
  const config = result as { zkpassport_version: bigint | { toBigInt(): bigint }; zkpassport_validity_period: bigint }
  const packed = typeof config.zkpassport_version === 'bigint' ? config.zkpassport_version : config.zkpassport_version.toBigInt()
  return { circuitsVersion: unpackCircuitsVersion(packed), validitySeconds: Number(config.zkpassport_validity_period) }
}
