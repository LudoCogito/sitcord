// Pure decision logic for the Select+Start show/hide chord and its interaction
// with the Start-alone Favorite action. Kept pure so the timing-sensitive combo
// behaviour can be unit-tested without a real controller.
//
// Why the grace window: pressing Select+Start together is rarely perfectly
// simultaneous. If Start registers a frame or two before Select, a naive
// implementation fires Favorite and then the chord. So Start-alone defers its
// Favorite by a small window; if Select arrives within it, the press is
// reinterpreted as the chord and the Favorite is cancelled.
export const CHORD_GRACE_MS = 150

export interface ComboState {
  chordHeld: boolean
  startHeld: boolean
  /** When Start went down alone; its Favorite is pending until resolved. */
  pendingFavoriteAt: number | null
}

export const initialComboState: ComboState = {
  chordHeld: false,
  startHeld: false,
  pendingFavoriteAt: null
}

export interface ComboInput {
  selectPressed: boolean
  startPressed: boolean
  now: number
}

export interface ComboResult {
  state: ComboState
  toggleVisibility: boolean
  toggleFavorite: boolean
}

export function stepCombo(
  prev: ComboState,
  input: ComboInput,
  graceMs = CHORD_GRACE_MS
): ComboResult {
  const { selectPressed, startPressed, now } = input
  const bothPressed = selectPressed && startPressed

  let toggleVisibility = false
  let pendingFavoriteAt = prev.pendingFavoriteAt

  // Chord rising edge -> show/hide; cancel any Favorite that was mid-grace.
  if (bothPressed && !prev.chordHeld) {
    toggleVisibility = true
    pendingFavoriteAt = null
  }

  // Start pressed alone -> start the grace window instead of firing now.
  const startEdge = startPressed && !prev.startHeld
  if (startEdge && !selectPressed) {
    pendingFavoriteAt = now
  }

  let toggleFavorite = false
  if (pendingFavoriteAt !== null) {
    if (selectPressed) {
      // Select arrived within the window: this was the chord, not a Favorite.
      pendingFavoriteAt = null
    } else if (!startPressed || now - pendingFavoriteAt >= graceMs) {
      // Quick tap released, or Start held past the window with no Select.
      toggleFavorite = true
      pendingFavoriteAt = null
    }
  }

  return {
    state: { chordHeld: bothPressed, startHeld: startPressed, pendingFavoriteAt },
    toggleVisibility,
    toggleFavorite
  }
}
