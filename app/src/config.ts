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

export const RPC_URL: string = env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com'
/** The CRISP server running in Aztec mode (`PROGRAM_KIND=aztec`): it stages ciphertexts and attests availability. */
export const CRISP_SERVER_URL: string = (env.VITE_CRISP_SERVER_URL || 'https://private-crisp.theinterfold.com/aztec').replace(
  /\/+$/,
  '',
)
/** The Aztec node voters transact through, and the one polls are read from. */
export const AZTEC_NODE_URL: string = (env.VITE_AZTEC_NODE_URL || 'https://aztec-testnet.drpc.org').replace(/\/+$/, '')
/**
 * The Aztec block explorer transactions and contracts are linked to: Aztec-Scan's testnet instance, which indexes the testnet the
 * node above serves. Its pages are `/tx-effects/<hash>` and `/contracts/instances/<address>`.
 */
export const AZTEC_EXPLORER_URL: string = (env.VITE_AZTEC_EXPLORER_URL || 'https://testnet.aztecscan.xyz').replace(/\/+$/, '')
/**
 * The ZKPassport domain the `CrispAztec` contract was deployed with. ZKPassport shows it to voters and
 * derives identifiers from it, so it is the host name the app is served from in production, also when
 * the app runs locally against that deployment.
 */
export const ZKPASSPORT_DOMAIN: string = env.VITE_ZKPASSPORT_DOMAIN || 'poll.theinterfold.com'
export const IPFS_GATEWAY: string = (env.VITE_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/').replace(/\/?$/, '/')
export const WALLETCONNECT_PROJECT_ID: string | undefined = env.VITE_WALLETCONNECT_PROJECT_ID || undefined

export const BOARD_ADDRESS: Address = address('VITE_BOARD_ADDRESS', env.VITE_BOARD_ADDRESS)

/** The running Sepolia deployment (`@interfold/contracts` 0.20.0, `@crisp-e3/sdk` 0.29.0). */
export const INTERFOLD_ADDRESS: Address = '0x5611c8aa517FE57D05229Ff94eA37E88b1b8FDDB'
export const FAUCET_ADDRESS: Address = '0x1B4340A65BB669267BF5DE37385B139987C3F09c'

/** Sepolia's ciphernodes run the insecure 64-degree set (id 4); it proves in seconds in a browser. */
export const PARAM_SET = 4

/**
 * The crypto configuration Interfold binds to a BFV parameter set AND a committee size (`ActiveCryptoConfig.configIdForRequest`).
 * A request names the one it expects, so a coordinator upgrade cannot switch circuits under it; any other combination reverts
 * with `CryptoConfigChanged`. Keyed `paramSet:committeeSize`.
 */
const CRYPTO_CONFIG_ID: Readonly<Record<string, Hex>> = {
  // insecure-64
  '4:0': '0xd76c4f521394e6cbe1df28036cc5dd5590c6630a403525b5c2b052f9b91507f4',
  '4:1': '0x893989231b402942b005fecdbf9eae21b227d861085433293d0873547ea2816a',
  '4:2': '0x7fa922a08c5501592d02394205bb600219da3e168e0432f076465569116ccfe3',
  // secure-8192
  '3:0': '0x0acc89be9b1f39b0c1ee06493af3bad6f5685bf60e0f1cec7a733e95caaab87a',
  '3:1': '0xebe75e3c1ada2079e5a06e5853d710b67ac296959c6b67f7d82b44312574dd0b',
  '3:2': '0x41d2f2a41bfb17dfb292332d8283b3a9238f9fa8fdc4eecf87de4d777f95c891',
}

/** The config id a request of this parameter set and committee size must expect; throws for a combination Interfold has no id for. */
export function cryptoConfigId(paramSet: number, committeeSize: number): Hex {
  const id = CRYPTO_CONFIG_ID[`${paramSet}:${committeeSize}`]
  if (!id) throw new Error(`Interfold has no crypto configuration for parameter set ${paramSet} with committee size ${committeeSize}.`)
  return id
}
/** CRISP ignores it on-chain; the server and runner read their own configuration. */
export const COMPUTE_PROVIDER_PARAMS = '{"name":"OpenVM","parallel":false,"batch_size":4}'
