import { getAddress, isAddress, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}

function address(name: string, value: string | undefined): Address {
  const v = required(name, value)
  if (!isAddress(v)) throw new Error(`${name} is not an address: ${v}`)
  return getAddress(v)
}

const env = import.meta.env

export const CHAIN = sepolia
/** ZKPassport's name for the chain a proof is bound to. */
export const ZKPASSPORT_CHAIN = 'ethereum_sepolia' as const

export const RPC_URL: string = env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com'
export const CRISP_SERVER_URL: string = (env.VITE_CRISP_SERVER_URL || 'https://private-crisp.theinterfold.com').replace(
  /\/+$/,
  '',
)
export const IPFS_GATEWAY: string = (env.VITE_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/').replace(/\/?$/, '/')
export const WALLETCONNECT_PROJECT_ID: string | undefined = env.VITE_WALLETCONNECT_PROJECT_ID || undefined

export const BOARD_ADDRESS: Address = address('VITE_BOARD_ADDRESS', env.VITE_BOARD_ADDRESS)

/** The running Sepolia deployment (`@interfold/contracts` 0.20.0-dev.3, `@crisp-e3/sdk` 0.28.1). */
export const INTERFOLD_ADDRESS: Address = '0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26'
export const FAUCET_ADDRESS: Address = '0x1B4340A65BB669267BF5DE37385B139987C3F09c'

/**
 * The circuit configuration Interfold binds to each BFV parameter set (`BfvProtocol.*_CONFIG_ID`).
 * A request names the one it expects, so a coordinator upgrade cannot switch circuits under it.
 */
export const CRYPTO_CONFIG_ID: Readonly<Record<number, Hex>> = {
  0: '0x92c8b373eb72cc3600a5a818cf8599db16e618ee3ece2dadd14f8608c1a43ac9',
  2: '0xa174862efd4487031d423ca96516807775ade0191c714e513aab93d0cc289baa',
}

/** Sepolia supports the insecure 64-degree set; it proves in seconds in a browser. */
export const PARAM_SET = 0
/** CRISP ignores it on-chain; the server and runner read their own configuration. */
export const COMPUTE_PROVIDER_PARAMS = '{"name":"OpenVM","parallel":false,"batch_size":4}'
