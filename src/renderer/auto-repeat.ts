// Pure auto-repeat cadence for a held directional input (the left stick). Held
// stick should behave like a held key: fire once, pause, then repeat at an
// accelerating rate so a long list scrolls quickly without the user mashing.
// Kept pure (time passed in) so the ramp is unit-testable without a real clock.

/** Pause after the first fire before auto-repeat begins. */
export const INITIAL_DELAY_MS = 260
/** Gap between the first few repeats (slow). */
export const START_INTERVAL_MS = 130
/** Fastest gap once fully ramped up. */
export const MIN_INTERVAL_MS = 28
/** How long the hold ramps from START down to MIN. */
export const RAMP_MS = 900

export interface RepeatState {
  /** When the current hold began, or null when not held. */
  heldSince: number | null
  /** When we last emitted, or null when not held. */
  lastFireAt: number | null
}

export const initialRepeatState: RepeatState = { heldSince: null, lastFireAt: null }

export interface RepeatResult {
  state: RepeatState
  fire: boolean
}

/** Repeat interval for a hold of `heldElapsed` ms — linearly accelerating from
 *  START_INTERVAL_MS down to MIN_INTERVAL_MS over RAMP_MS after the delay. */
export function repeatIntervalAt(heldElapsed: number): number {
  const t = Math.min(1, Math.max(0, (heldElapsed - INITIAL_DELAY_MS) / RAMP_MS))
  return START_INTERVAL_MS + (MIN_INTERVAL_MS - START_INTERVAL_MS) * t
}

/** Advance the repeat state by one poll given whether the input is currently
 *  held and the current time. Returns the next state and whether to emit now. */
export function stepRepeat(prev: RepeatState, held: boolean, now: number): RepeatResult {
  if (!held) return { state: initialRepeatState, fire: false }

  // Press edge: fire once immediately.
  if (prev.heldSince === null) {
    return { state: { heldSince: now, lastFireAt: now }, fire: true }
  }

  const elapsed = now - prev.heldSince
  if (elapsed < INITIAL_DELAY_MS) {
    return { state: prev, fire: false }
  }

  const interval = repeatIntervalAt(elapsed)
  const sinceLastFire = now - (prev.lastFireAt ?? prev.heldSince)
  if (sinceLastFire >= interval) {
    return { state: { heldSince: prev.heldSince, lastFireAt: now }, fire: true }
  }
  return { state: prev, fire: false }
}
