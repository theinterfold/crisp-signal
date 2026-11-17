import { Link } from 'react-router-dom'

const STEPS = [
  {
    title: 'An organiser opens a poll',
    body: 'The question and options go to IPFS. The poll board, one transaction on Ethereum, asks the Interfold for a CRISP round that runs on Aztec. A committee of ciphernodes generates a shared key; no single node can decrypt alone.',
  },
  {
    title: 'Voters prove eligibility with ZKPassport',
    body: "The ZKPassport app reads the passport or ID card chip and proves on the phone that its holder meets the rule: a minimum age, if the poll sets one. The poll's contract on Aztec verifies the proof, which your browser proves into a transaction paid by Aztec's sponsored fee contract: no Ethereum wallet and no gas. It learns a per-poll identifier for the document, so the same document cannot register twice, and nothing else about the person.",
  },
  {
    title: 'Ballots are encrypted and proven in the browser',
    body: 'The vote is encrypted to the committee key with fully homomorphic encryption, and a zero-knowledge proof shows it is a valid ballot for a registered address. The CRISP server stores the ciphertext and attests it, and the ballot is cast on Aztec. Voters can recast; the latest ballot counts.',
  },
  {
    title: 'Masks make receipts worthless',
    body: "Anyone can add a mask to a verified voter's slot: an empty encrypted ballot that leaves the slot's choice unchanged. On-chain a mask looks exactly like a vote or a re-vote, so a voter cannot prove to a briber or coercer how, or whether, they voted.",
  },
  {
    title: 'Only the tally is decrypted',
    body: 'When voting closes, the round is sealed on Aztec and, once Aztec has proven the epoch (usually 1–2 hours), its input root reaches Ethereum. The encrypted ballots are then summed while still encrypted, and the committee decrypts only that sum and publishes it, with proofs, on Ethereum. Individual choices are never decrypted.',
  },
]

const LIMITS = [
  'Eligibility is per document: someone with two qualifying documents (for example a passport and an ID card) can register twice.',
  'Verification trusts ZKPassport\'s circuits and its certificate registry on Aztec, which ZKPassport administers.',
  'This demo runs on Ethereum Sepolia and the Aztec testnet, with mock compute verification and a mock data-availability layer.',
  'Your Aztec account and per-poll slot keys live in this browser: clearing its storage loses them, so download the backup the poll page offers.',
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
