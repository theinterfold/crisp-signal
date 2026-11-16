import { Link } from 'react-router-dom'

const STEPS = [
  {
    title: 'An organiser opens a poll',
    body: 'The question and options go to IPFS. The poll board deploys a census registry holding the eligibility rules and asks the Interfold for a CRISP round. A committee of ciphernodes generates a shared key; no single node can decrypt alone.',
  },
  {
    title: 'Voters prove eligibility with ZKPassport',
    body: "The ZKPassport app reads the passport or ID card chip and proves on the phone that its holder meets the rules: minimum age, nationality, optionally a face match. The poll's registry verifies the proof on-chain. It learns a per-poll identifier for the document, so the same document cannot register twice, and nothing else about the person.",
  },
  {
    title: 'Ballots are encrypted and proven in the browser',
    body: 'The vote is encrypted to the committee key with fully homomorphic encryption, and a zero-knowledge proof shows it is a valid ballot for a registered address. The CRISP relay stages it and records a commitment on-chain. Voters can recast; the latest ballot counts.',
  },
  {
    title: 'Masks make receipts worthless',
    body: "Anyone can add a mask to a verified voter's slot: an empty encrypted ballot that leaves the slot's choice unchanged. On-chain a mask looks exactly like a vote or a re-vote, so a voter cannot prove to a briber or coercer how, or whether, they voted.",
  },
  {
    title: 'Only the tally is decrypted',
    body: 'When voting closes, the encrypted ballots are summed while still encrypted. The committee decrypts only that sum and publishes it, with proofs, on-chain. Individual choices are never decrypted.',
  },
]

const LIMITS = [
  'Eligibility is per document: someone with two qualifying documents (for example a passport and an ID card) can register two wallets.',
  'Verification trusts ZKPassport\'s on-chain verifier and its certificate registry, which ZKPassport administers.',
  'This demo runs on the Sepolia CRISP deployment, which uses mock compute verification and a mock data-availability layer.',
  'Polls that accept mock IDs are open to anyone: use them for rehearsals only.',
]

export function AboutPage() {
  return (
    <div style={{ maxWidth: 760 }}>
      <span className="eyebrow">How it works</span>
      <h1 style={{ margin: '8px 0 16px' }}>One verified person, one secret vote</h1>
      <p className="muted" style={{ marginBottom: 32 }}>
        CRISP Signal combines three systems: ZKPassport for private identity checks, the Interfold for threshold
        key management and encrypted computation, and CRISP for coercion-resistant ballots and tallying. Polls are
        signalling only: results are published, nothing is executed.
      </p>
      <div className="stack">
        {STEPS.map((step, i) => (
          <section className="card" key={step.title} style={{ marginTop: 0 }}>
            <span className="eyebrow">Step {i + 1}</span>
            <h2 style={{ margin: '6px 0 10px' }}>{step.title}</h2>
            <p className="muted">{step.body}</p>
          </section>
        ))}
        <section className="card" style={{ marginTop: 0 }}>
          <h2 style={{ marginBottom: 10 }}>Limits to know</h2>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            {LIMITS.map((l) => (
              <li key={l} style={{ marginBottom: 6 }}>
                {l}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="row" style={{ marginTop: 28 }}>
        <Link to="/create" className="btn">
          Create a poll
        </Link>
        <Link to="/" className="btn secondary">
          Browse polls
        </Link>
      </div>
    </div>
  )
}
