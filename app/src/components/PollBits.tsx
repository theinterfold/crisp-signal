import type { ReactNode } from 'react'
import { Info, WarningCircle, CheckCircle } from '@phosphor-icons/react'
import { OPTION_COLORS, PHASE_LABEL } from '../lib/format'
import type { Phase } from '../lib/polls'

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span className={`badge ${phase}`}>
      <span className="dot" />
      {PHASE_LABEL[phase]}
    </span>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warning' | 'success'; children: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle : tone === 'info' ? Info : WarningCircle
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={16} weight="bold" />
      <div className="notice-body">{children}</div>
    </div>
  )
}

const percent = (value: bigint, total: bigint) => (total === 0n ? 0 : Number((value * 10_000n) / total) / 100)

export function Results({ options, tally }: { options: string[]; tally: bigint[] }) {
  const total = tally.reduce((a, b) => a + b, 0n)
  return (
    <div>
      {tally.map((votes, i) => (
        <div className="result" key={i}>
          <div className="result-head">
            <span className="row">
              <span className="swatch" style={{ background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
              {options[i] ?? `Option ${i + 1}`}
            </span>
            <span className="num">
              {votes.toString()} · {percent(votes, total).toFixed(1)}%
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${percent(votes, total)}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MiniBar({ tally }: { tally: bigint[] }) {
  const total = tally.reduce((a, b) => a + b, 0n)
  return (
    <div className="mini-bar" aria-hidden>
      {tally.map((v, i) => (
        <span key={i} style={{ width: `${percent(v, total)}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }} />
      ))}
    </div>
  )
}
