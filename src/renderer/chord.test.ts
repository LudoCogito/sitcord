import { describe, it, expect } from 'vitest'
import { initialComboState, stepCombo, type ComboState } from './chord'

const GRACE = 150

// Convenience: run a sequence of frames through stepCombo, collecting fires.
function run(frames: Array<{ select: boolean; start: boolean; now: number }>) {
  let state: ComboState = initialComboState
  const toggles: number[] = []
  const favorites: number[] = []
  for (const f of frames) {
    const r = stepCombo(state, { selectPressed: f.select, startPressed: f.start, now: f.now }, GRACE)
    if (r.toggleVisibility) toggles.push(f.now)
    if (r.toggleFavorite) favorites.push(f.now)
    state = r.state
  }
  return { toggles, favorites }
}

describe('stepCombo', () => {
  it('fires show/hide once on the chord rising edge and no favorite', () => {
    const { toggles, favorites } = run([
      { select: true, start: true, now: 0 },
      { select: true, start: true, now: 16 }
    ])
    expect(toggles).toEqual([0])
    expect(favorites).toEqual([])
  })

  it('within the grace window a Start-then-Select roll becomes the chord, not a favorite', () => {
    const { toggles, favorites } = run([
      { select: false, start: true, now: 0 }, // Start lands first
      { select: true, start: true, now: 40 } // Select lands 40ms later, inside grace
    ])
    expect(toggles).toEqual([40])
    expect(favorites).toEqual([])
  })

  it('commits the favorite once the grace window elapses with Start still held alone', () => {
    const { favorites } = run([
      { select: false, start: true, now: 0 },
      { select: false, start: true, now: 100 }, // still inside grace
      { select: false, start: true, now: 160 } // past grace
    ])
    expect(favorites).toEqual([160])
  })

  it('commits the favorite on a quick Start tap released inside the grace window', () => {
    const { favorites } = run([
      { select: false, start: true, now: 0 },
      { select: false, start: false, now: 20 } // released quickly, no Select
    ])
    expect(favorites).toEqual([20])
  })

  it('does not re-fire the chord while held', () => {
    const { toggles } = run([
      { select: true, start: true, now: 0 },
      { select: true, start: true, now: 16 },
      { select: true, start: true, now: 32 }
    ])
    expect(toggles).toEqual([0])
  })

  it('fires the favorite only once while Start is held past the window', () => {
    const { favorites } = run([
      { select: false, start: true, now: 0 },
      { select: false, start: true, now: 200 },
      { select: false, start: true, now: 216 }
    ])
    expect(favorites).toEqual([200])
  })
})
