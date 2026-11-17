import { getClient, loadCrispSdk, loadSdk } from './aztec'
import { ensureCircuits } from './circuits'

/*
 * Everything a ballot needs before its first proof can start, done once and in the background while the voter reads the poll:
 *   - the Aztec session (embedded wallet and PXE, the contract and the SponsoredFPC registered in it);
 *   - the base circuits, and bb.js's WASM and worker threads with the 2^21-point SRS the three base proofs use (the SDK starts both
 *     with the first call that needs its backend, and computing the circuits' verification keys, which proves nothing, is the
 *     cheapest such call it exports);
 *   - the staging pass's SRS (2^17 points and the Grumpkin points bb.js adds), into bb.js's own cache.
 * It proves nothing and sends nothing: the same objects are reused by the registration, vote and mask flows.
 */

const started = new Map<number, Promise<void>>()

/** The staging pass circuit has 2^17 gates and bb.js loads 2^16 Grumpkin points next to them (`Barretenberg.new`). */
const PASS_SRS_SIZE = 2 ** 17
const GRUMPKIN_SRS_SIZE = 2 ** 16

async function prepareBaseProver(paramSet: number) {
  await ensureCircuits(paramSet)
  const { getBaseVerificationKeys } = await loadCrispSdk()
  await getBaseVerificationKeys()
}

async function prepareStagingPassSrs() {
  const [{ Crs, GrumpkinCrs }] = await Promise.all([import('@aztec-foundation/bb.js'), loadSdk()])
  await Promise.all([Crs.new(PASS_SRS_SIZE), GrumpkinCrs.new(GRUMPKIN_SRS_SIZE)])
}

/**
 * Starts the preparation for a poll of this parameter set, once: later calls share the same promise, which settles when every part is
 * done. A part that failed does not reject it (the flow that needs that part fails with its own error, and a later call retries).
 */
export function warmUp(paramSet: number): Promise<void> {
  let warm = started.get(paramSet)
  if (!warm) {
    warm = Promise.allSettled([getClient(), prepareBaseProver(paramSet), prepareStagingPassSrs()]).then((parts) => {
      const failed = parts.filter((part): part is PromiseRejectedResult => part.status === 'rejected')
      if (failed.length > 0) {
        started.delete(paramSet)
        for (const { reason } of failed) console.warn('Preparing the prover failed', reason)
      }
    })
    started.set(paramSet, warm)
  }
  return warm
}
