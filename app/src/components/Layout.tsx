import { NavLink, Link, Outlet } from 'react-router-dom'
import logo from '../assets/crisp-logo.svg?raw'
import { BOARD_ADDRESS, CHAIN } from '../config'
import { ConnectButton } from './ConnectButton'

export function Layout() {
  return (
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
          <ConnectButton />
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
            <a href="https://theinterfold.com">the Interfold</a>. Eligibility by{' '}
            <a href="https://zkpassport.id">ZKPassport</a>.
          </span>
          <span className="mono">
            {CHAIN.name} ·{' '}
            <a href={`${CHAIN.blockExplorers.default.url}/address/${BOARD_ADDRESS}`} target="_blank" rel="noreferrer">
              board {BOARD_ADDRESS.slice(0, 8)}…
            </a>
          </span>
        </div>
      </footer>
    </>
  )
}
