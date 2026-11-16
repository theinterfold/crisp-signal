import { BaseError, UserRejectedRequestError } from 'viem'
import { COUNTRY_NAME } from './countries'
import { NationalityRule, type Phase, type Policy } from './polls'

export const OPTION_COLORS = ['#3a5e3c', '#a84932', '#7a7d77', '#355a8a', '#8a6a40', '#5a4a8a', '#2f7a6a', '#9a7a30', '#4a6f7a', '#7a4a5e']

export const PHASE_LABEL: Record<Phase, string> = {
  preparing: 'Preparing',
  scheduled: 'Scheduled',
  open: 'Open',
  tallying: 'Tallying',
  decrypting: 'Decrypting',
  final: 'Final',
  failed: 'Failed',
  stalled: 'Did not open',
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const shortHex = (h: string) => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h)

export function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

/** "closes in 2h 5m" / "closed 3d 1h ago" for the phase a poll is in. */
export function timing(phase: Phase, opensAt: number, closesAt: number, now = Date.now() / 1000) {
  switch (phase) {
    case 'preparing':
      return now < opensAt ? `Opens in ${formatDuration(opensAt - now)}` : 'Waiting for the committee key'
    case 'scheduled':
      return `Opens in ${formatDuration(opensAt - now)}`
    case 'open':
      return `Closes in ${formatDuration(closesAt - now)}`
    default:
      return `Closed ${formatDate(closesAt)}`
  }
}

export function countryList(codes: string[]) {
  return codes.map((c) => COUNTRY_NAME[c] ?? c)
}

/** Human-readable eligibility rules, one per chip. */
export function eligibilityChips(policy: Policy): string[] {
  const chips = ['One vote per document']
  if (policy.minAge > 0) chips.push(`Age ${policy.minAge}+`)
  if (policy.nationalityRule !== NationalityRule.Any) {
    const names = countryList(policy.countries)
    const list = names.length <= 3 ? names.join(', ') : `${names.length} countries`
    chips.push(policy.nationalityRule === NationalityRule.Allow ? `Nationals of ${list}` : `Excludes ${list}`)
  }
  if (policy.faceMatch) chips.push('FaceMatch')
  if (policy.devMode) chips.push('Mock IDs accepted')
  return chips
}

/** The shortest message that explains a failed wallet or contract call. */
export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return 'Request rejected in the wallet.'
    return error.shortMessage
  }
  if (error instanceof Error) return error.message
  return String(error)
}
