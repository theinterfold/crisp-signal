import { useMemo, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { COUNTRIES, COUNTRY_NAME, COUNTRY_PRESETS } from '../lib/countries'

/** `CRISPRemoteProgram` accepts at most this many alpha-3 codes. */
export const MAX_COUNTRIES = 200

/**
 * Sorted, de-duplicated codes. ZKPassport sorts an exclusion list before committing to it and keeps an inclusion list in the order
 * given, so one sorted order serves both rules and the list the poll announces is the one every verifier commits to.
 */
export const canonical = (codes: Iterable<string>) => [...new Set(codes)].sort()

export function CountryPicker({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [search, setSearch] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return COUNTRIES.filter((c) => !selected.has(c.code) && (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q))
  }, [search, selected])

  const add = (codes: string[]) => onChange(canonical([...value, ...codes]).slice(0, MAX_COUNTRIES))
  const remove = (code: string) => onChange(value.filter((c) => c !== code))

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        {COUNTRY_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="btn secondary sm" onClick={() => add(preset.codes)}>
            + {preset.label}
          </button>
        ))}
        {value.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="chips">
          {value.map((code) => (
            <button type="button" key={code} className="chip removable" onClick={() => remove(code)} title="Remove">
              {COUNTRY_NAME[code] ?? code} <span className="mono">{code}</span> <X size={10} weight="bold" />
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder="Search countries…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search countries"
      />
      <div className="country-list">
        {matches.slice(0, 60).map((c) => (
          <button type="button" key={c.code} onClick={() => add([c.code])}>
            <span>{c.name}</span>
            <span className="mono">{c.code}</span>
          </button>
        ))}
        {matches.length === 0 && <p className="hint" style={{ padding: 12 }}>No more countries match.</p>}
      </div>
    </div>
  )
}
