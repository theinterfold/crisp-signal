import { formatDate } from '../lib/format'
import { useInputRootTx } from '../lib/explorer'
import type { Poll } from '../lib/polls'
import { ExplorerLink } from './ExplorerLink'
import { StepRow } from './PollBits'

/**
 * After voting closes the round's input root reaches Ethereum only once Aztec has proven the epoch that holds the close: about one to
 * two hours (the README's estimate; the program accepts the root from `remoteFinalityWindow` on, 3 hours on this deployment). The
 * tally is then computed and decrypted, which has no estimate here. The times below are estimates, and are labelled as such.
 */
const EPOCH_PROOF_MIN_SECONDS = 60 * 60
const EPOCH_PROOF_MAX_SECONDS = 2 * 60 * 60

const time = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** What is known about a closed poll's way to a result: closed on Aztec, the root on Ethereum, the compute. */
export function ResultStatus({ poll, now }: { poll: Poll; now: number }) {
  const rootTx = useInputRootTx(poll)
  const { aztec, rootSubmitted, closesAt } = poll
  const closed = aztec?.closed ?? false
  const early = closesAt + EPOCH_PROOF_MIN_SECONDS
  const late = closesAt + EPOCH_PROOF_MAX_SECONDS

  return (
    <div className="steps">
      <StepRow index={1} label="Voting closed" state="done" detail={formatDate(closesAt)} />
      <StepRow
        index={2}
        label="Round closed on Aztec"
        state={closed ? 'done' : 'active'}
        detail={
          closed ? (
            aztec?.txs.closed && <ExplorerLink chain="aztec" kind="tx" id={aztec.txs.closed} />
          ) : aztec ? (
            'Waiting for the keeper to close the round'
          ) : (
            'The Aztec node cannot be read right now'
          )
        }
      />
      <StepRow
        index={3}
        label="Input root on Ethereum"
        state={rootSubmitted ? 'done' : closed ? 'active' : 'todo'}
        detail={
          rootSubmitted ? (
            rootTx ? <ExplorerLink chain="l1" kind="tx" id={rootTx} /> : 'Delivered'
          ) : now > late ? (
            'Later than usual: Aztec has not proven the epoch that holds the close yet'
          ) : (
            `Results expected around ${time(early)}–${time(late)} (estimate: Aztec proves the epoch about 1–2 hours after the close; the tally is computed and decrypted after that)`
          )
        }
      />
      <StepRow
        index={4}
        label="Computing and decrypting the tally"
        state={rootSubmitted ? 'active' : 'todo'}
        detail={rootSubmitted ? 'The committee is working on the encrypted ballots' : undefined}
      />
    </div>
  )
}
