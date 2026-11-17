import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PollsPage } from './pages/Polls'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

// The poll list is the landing page; the others load when visited, and with them what only they use: the Aztec stack and bb.js for
// a poll, the wallet stack for creating one.
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <PollsPage /> },
      { path: '/create', lazy: async () => ({ Component: (await import('./pages/CreatePoll')).CreatePollPage }) },
      { path: '/poll/:id', lazy: async () => ({ Component: (await import('./pages/PollPage')).PollPage }) },
      { path: '/about', lazy: async () => ({ Component: (await import('./pages/About')).AboutPage }) },
    ],
  },
])

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} fallbackElement={null} />
    </QueryClientProvider>
  )
}
