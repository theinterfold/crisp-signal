import { ConnectKitProvider } from 'connectkit'
import type { ReactNode } from 'react'
import { custom, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createConfig, WagmiProvider } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { CHAIN, RPC_URL, WALLETCONNECT_PROJECT_ID } from '../config'

/*
 * The wallet stack (wagmi, ConnectKit, WalletConnect) is only for creators: voters never connect a wallet. It is loaded with the
 * pages that use it (creating a poll, claiming a failed poll's refund), not with the app.
 */

// ConnectKit resolves ENS names on mainnet, and when mainnet is missing from the config it builds its
// own client on viem's default public RPC. Listing mainnet with a transport that never calls out
// keeps every request on our RPC; ENS names are simply not shown. (Same as the CRISP client.)
const noMainnetRpc = custom({
  request: async () => {
    throw new Error('mainnet RPC disabled (ENS lookups suppressed)')
  },
})

const wagmiConfig = createConfig({
  chains: [CHAIN, mainnet],
  connectors: [
    injected(),
    // ConnectKit draws the QR code itself.
    ...(WALLETCONNECT_PROJECT_ID ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: false })] : []),
  ],
  transports: { [CHAIN.id]: http(RPC_URL), [mainnet.id]: noMainnetRpc },
})

// The wallet modal in the app's own type, colours and corners.
const walletTheme = {
  '--ck-font-family': "'Inter Variable', 'Inter', system-ui, sans-serif",
  '--ck-border-radius': '10px',
  '--ck-primary-button-border-radius': '6px',
  '--ck-secondary-button-border-radius': '6px',
  '--ck-body-color': '#121718',
  '--ck-body-color-muted': '#596364',
  '--ck-body-background': '#ffffff',
  '--ck-body-background-secondary': '#f4f5f4',
  '--ck-body-divider': '#e7e8e8',
  '--ck-overlay-background': 'rgba(18, 23, 24, 0.35)',
  '--ck-accent-color': '#3a5e3c',
  '--ck-accent-text-color': '#ffffff',
  '--ck-focus-color': '#3a5e3c',
}

/** Needs the app's QueryClientProvider above it. */
export default function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <ConnectKitProvider
        mode="light"
        theme="minimal"
        customTheme={walletTheme}
        options={{ initialChainId: CHAIN.id, hideBalance: true, embedGoogleFonts: false }}
      >
        {children}
      </ConnectKitProvider>
    </WagmiProvider>
  )
}
