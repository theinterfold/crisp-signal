const UNITS = [
  { key: 'days', label: 'days', seconds: 86400, max: 365 },
  { key: 'hours', label: 'hours', seconds: 3600, max: 23 },
  { key: 'minutes', label: 'min', seconds: 60, max: 59 },
] as const

/** A length of time in seconds, edited as days, hours and minutes. Inputs are `${id}-days` etc. */
export function DurationInput({ id, value, onChange }: { id: string; value: number; onChange: (seconds: number) => void }) {
  const parts = UNITS.map((u, i) => {
    const above = i === 0 ? Infinity : UNITS[i - 1].seconds
    return Math.floor((value % above) / u.seconds)
  })

  const set = (index: number, raw: string) => {
    const unit = UNITS[index]
    const n = Math.min(unit.max, Math.max(0, Math.floor(Number(raw) || 0)))
    onChange(parts.reduce((total, part, i) => total + (i === index ? n : part) * UNITS[i].seconds, 0))
  }

  return (
    <div className="duration">
      {UNITS.map((u, i) => (
        <label key={u.key} className="duration-part">
          <input
            id={`${id}-${u.key}`}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={u.max}
            value={parts[i]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => set(i, e.target.value)}
          />
          <span className="duration-unit">{u.label}</span>
        </label>
      ))}
    </div>
  )
}
