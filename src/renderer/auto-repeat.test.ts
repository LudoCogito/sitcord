import { describe, it, expect } from 'vitest'
import {
  stepRepeat,
  repeatIntervalAt,
  initialRepeatState,
  INITIAL_DELAY_MS,
  START_INTERVAL_MS,
  MIN_INTERVAL_MS
} from './auto-repeat'

describe('repeatIntervalAt', () => {
  it('starts slow and accelerates to the floor the longer it is held', () => {
    expect(repeatIntervalAt(INITIAL_DELAY_MS)).toBeCloseTo(START_INTERVAL_MS)
    expect(repeatIntervalAt(INITIAL_DELAY_MS + 100000)).toBeCloseTo(MIN_INTERVAL_MS)
    const early = repeatIntervalAt(INITIAL_DELAY_MS + 100)
    const later = repeatIntervalAt(INITIAL_DELAY_MS + 600)
    expect(later).toBeLessThan(early)
  })
})

describe('stepRepeat', () => {
  it('does nothing while not held', () => {
    const r = stepRepeat({ heldSince: 500, lastFireAt: 500 }, false, 1000)
    expect(r.fire).toBe(false)
    expect(r.state).toEqual(initialRepeatState)
  })

  it('fires immediately on the press edge', () => {
    const r = stepRepeat(initialRepeatState, true, 1000)
    expect(r.fire).toBe(true)
    expect(r.state).toEqual({ heldSince: 1000, lastFireAt: 1000 })
  })

  it('waits out the initial delay before the first repeat', () => {
    const held = { heldSince: 1000, lastFireAt: 1000 }
    expect(stepRepeat(held, true, 1000 + INITIAL_DELAY_MS - 1).fire).toBe(false)
  })

  it('repeats once the delay passes, then waits the computed interval', () => {
    const held = { heldSince: 1000, lastFireAt: 1000 }
    const firstRepeatAt = 1000 + INITIAL_DELAY_MS + START_INTERVAL_MS
    const fired = stepRepeat(held, true, firstRepeatAt)
    expect(fired.fire).toBe(true)
    expect(fired.state.lastFireAt).toBe(firstRepeatAt)

    // Immediately after firing, not enough time has passed for another.
    expect(stepRepeat(fired.state, true, firstRepeatAt + 1).fire).toBe(false)
  })
})
