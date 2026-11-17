import { lazy, Suspense } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import logo from '../assets/crisp-logo.svg?raw'
import { BOARD_ADDRESS, CHAIN } from '../config'
import { ExplorerLink } from './ExplorerLink'

// The wallet stack is only for creators, so it loads with the create page.
const WalletProvider = lazy(() => import('../lib/wallet'))
const ConnectButton = lazy(() => import('./ConnectButton').then((m) => ({ default: m.ConnectButton })))

export function Layout() {
  // Only creating a poll (or claiming a failed poll's refund) uses a wallet: voters register and vote without one.
  const creating = useLocation().pathname === '/create'
  const page = (
    <>
      <header className="header">
        <div className="container">
          <Link to="/" className="brand" aria-label="CRISP Signal home">
            <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logo }} />
            <span className="brand-tag">Signal</span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              Polls
            </NavLink>
            <NavLink to="/create">Create poll</NavLink>
            <NavLink to="/about">How it works</NavLink>
          </nav>
          {creating && <ConnectButton />}
        </div>
      </header>
      <main>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="footer">
        <div className="container">
          <span>
            Secret ballots by <a href="https://github.com/theinterfold/CRISP">CRISP</a> on{' '}
            <a href="https://theinterfold.com">the Interfold</a> and <a href="https://aztec.network">Aztec</a>. Eligibility by{' '}
            <a href="https://zkpassport.id">ZKPassport</a>.
          </span>
          <span className="mono">
            {CHAIN.name} ·{' '}
            <ExplorerLink chain="l1" kind="address" id={BOARD_ADDRESS} label={`board ${BOARD_ADDRESS.slice(0, 8)}…`} />
          </span>
        </div>
      </footer>
    </>
  )
  return creating ? (
    <Suspense fallback={null}>
      <WalletProvider>{page}</WalletProvider>
    </Suspense>
  ) : (
    page
  )
}
