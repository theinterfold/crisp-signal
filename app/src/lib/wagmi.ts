import { createPublicClient, custom, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createConfig } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { CHAIN, RPC_URL, WALLETCONNECT_PROJECT_ID } from '../config'

// ConnectKit resolves ENS names on mainnet, and when mainnet is missing from the config it builds its
// own client on viem's default public RPC. Listing mainnet with a transport that never calls out
// keeps every request on our RPC; ENS names are simply not shown. (Same as the CRISP client.)
const noMainnetRpc = custom({
  request: async () => {
    throw new Error('mainnet RPC disabled (ENS lookups suppressed)')
  },
})

export const wagmiConfig = createConfig({
  chains: [CHAIN, mainnet],
  connectors: [
    injected(),
    // ConnectKit draws the QR code itself.
    ...(WALLETCONNECT_PROJECT_ID ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: false })] : []),
  ],
  transports: { [CHAIN.id]: http(RPC_URL), [mainnet.id]: noMainnetRpc },
})

/** Reads outside React, on the same endpoint wagmi uses; concurrent reads share one multicall. */
export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL), batch: { multicall: true } })
