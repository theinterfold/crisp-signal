import { useEffect, useRef, useState } from 'react'

/** Countdown labels count in minutes, so the clock ticks at least this often. */
const TICK_SECONDS = 60
/** A timer can fire a hair early; this keeps it from landing just before the boundary it waits for. */
const MARGIN_MS = 250

/**
 * The current time in Unix seconds, kept current: it changes when a boundary passes (a poll opening or closing) and at least once a
 * minute (for countdown labels), by one timer set for the next of these, never a tight poll. A tab that was in the background (where
 * browsers hold timers back) catches up when it is shown again. `onBoundary` runs once for each boundary that has passed, after the
 * state is updated, so a page can refetch what the new time makes it want (the round opening, the key relayed, the result).
 */
export function useNow(boundaries: readonly number[], onBoundary?: () => void): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  const boundary = useRef(onBoundary)
  boundary.current = onBoundary
  // The effect depends on the values, not on the array a caller builds each render.
  const key = boundaries.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = Date.now() / 1000

    const advance = () => {
      const current = Date.now() / 1000
      const crossed = boundaries.some((boundary) => boundary > last && boundary <= current)
      last = current
      setNow(current)
      if (crossed) boundary.current?.()
      schedule()
    }
    const schedule = () => {
      clearTimeout(timer)
      const current = Date.now() / 1000
      const next = Math.min(current + TICK_SECONDS, ...boundaries.filter((boundary) => boundary > current))
      timer = setTimeout(advance, Math.max(0, (next - current) * 1000) + MARGIN_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') advance()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `boundaries`.
  }, [key])

  return now
}
