import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { Layout } from './components/Layout'
import { CHAIN } from './config'
import { wagmiConfig } from './lib/wagmi'
import { AboutPage } from './pages/About'
import { CreatePollPage } from './pages/CreatePoll'
import { PollPage } from './pages/PollPage'
import { PollsPage } from './pages/Polls'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

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

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <PollsPage /> },
      { path: '/create', element: <CreatePollPage /> },
      { path: '/poll/:id', element: <PollPage /> },
      { path: '/about', element: <AboutPage /> },
    ],
  },
])

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode="light"
          theme="minimal"
          customTheme={walletTheme}
          options={{ initialChainId: CHAIN.id, hideBalance: true, embedGoogleFonts: false }}
        >
          <RouterProvider router={router} />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
