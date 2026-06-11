import { describe, it, expect } from 'vitest'
import { initialChordState, stepChord } from './chord'

describe('stepChord', () => {
  it('fires once on the rising edge of both buttons held', () => {
    const r = stepChord(initialChordState, true)
    expect(r.fired).toBe(true)
    expect(r.state.held).toBe(true)
  })

  it('does not fire again while the combo stays held', () => {
    const first = stepChord(initialChordState, true)
    const second = stepChord(first.state, true)
    expect(second.fired).toBe(false)
    expect(second.state.held).toBe(true)
  })

  it('does not fire when the combo is not both-pressed', () => {
    const r = stepChord(initialChordState, false)
    expect(r.fired).toBe(false)
    expect(r.state.held).toBe(false)
  })

  it('re-arms after release so the next press fires again', () => {
    const down = stepChord(initialChordState, true)
    const up = stepChord(down.state, false)
    const downAgain = stepChord(up.state, true)
    expect(up.fired).toBe(false)
    expect(downAgain.fired).toBe(true)
  })
})
