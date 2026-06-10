import { describe, it, expect } from 'vitest'
import { adjustScale, MIN_SCALE, MAX_SCALE } from './scale'

describe('adjustScale', () => {
  it('steps up and down by a fixed increment', () => {
    expect(adjustScale(1, 'in')).toBeCloseTo(1.1)
    expect(adjustScale(1, 'out')).toBeCloseTo(0.9)
  })

  it('clamps at the maximum and minimum', () => {
    expect(adjustScale(MAX_SCALE, 'in')).toBe(MAX_SCALE)
    expect(adjustScale(MIN_SCALE, 'out')).toBe(MIN_SCALE)
  })

  it('resets to 1', () => {
    expect(adjustScale(1.7, 'reset')).toBe(1)
    expect(adjustScale(0.6, 'reset')).toBe(1)
  })

  it('avoids floating-point drift when stepping', () => {
    let s = 1
    for (let i = 0; i < 3; i++) s = adjustScale(s, 'in')
    expect(s).toBeCloseTo(1.3)
    expect(Number.isInteger(s * 10)).toBe(true)
  })
})
