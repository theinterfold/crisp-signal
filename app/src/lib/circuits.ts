import type { CircuitBundle, CircuitPreset } from '@crisp-e3/sdk'
import { loadCrispSdk } from './aztec'

const CIRCUITS: Record<number, { preset: CircuitPreset; load: () => Promise<{ loadCircuits: () => Promise<CircuitBundle> }> }> = {
  0: { preset: 'insecure-64', load: () => import('@crisp-e3/sdk/insecure-64') },
  2: { preset: 'secure-8192', load: () => import('@crisp-e3/sdk/secure-8192') },
}
let loading: { preset: CircuitPreset; done: Promise<void> } | undefined

/** Installs the circuits of a round's parameter set, once per session. */
export async function ensureCircuits(paramSet: number) {
  const entry = CIRCUITS[paramSet]
  if (!entry) throw new Error(`This poll uses parameter set ${paramSet}, which this app has no circuits for.`)
  const { registeredPreset, setCircuits } = await loadCrispSdk()
  const active = registeredPreset() ?? loading?.preset
  // Proving against circuits of another preset produces ballots the verifier rejects.
  if (active && active !== entry.preset) {
    throw new Error(`Circuits for ${active} are loaded; reload the page to vote on this poll.`)
  }
  if (registeredPreset() === entry.preset) return
  loading ??= {
    preset: entry.preset,
    done: entry
      .load()
      .then(async ({ loadCircuits }) => setCircuits(await loadCircuits()))
      .catch((error) => {
        loading = undefined
        throw error
      }),
  }
  await loading.done
}
