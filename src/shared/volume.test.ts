import { describe, it, expect } from 'vitest'
import { VOLUME_RANGES, clampVolume, stepVolume } from './volume'

describe('volume ranges', () => {
  it('input is 0–100, output is 0–200', () => {
    expect(VOLUME_RANGES.input.min).toBe(0)
    expect(VOLUME_RANGES.input.max).toBe(100)
    expect(VOLUME_RANGES.output.min).toBe(0)
    expect(VOLUME_RANGES.output.max).toBe(200)
  })
})

describe('clampVolume', () => {
  it('clamps below the minimum to the minimum', () => {
    expect(clampVolume(-10, 'input')).toBe(0)
    expect(clampVolume(-10, 'output')).toBe(0)
  })

  it('clamps above the maximum to the per-target maximum', () => {
    expect(clampVolume(150, 'input')).toBe(100)
    expect(clampVolume(500, 'output')).toBe(200)
  })

  it('passes values within range through, rounded to an integer', () => {
    expect(clampVolume(73, 'input')).toBe(73)
    expect(clampVolume(73.6, 'input')).toBe(74)
    expect(clampVolume(150, 'output')).toBe(150)
  })

  it('falls back to the minimum for non-finite values', () => {
    expect(clampVolume(Number.NaN, 'input')).toBe(0)
    expect(clampVolume(Number.POSITIVE_INFINITY, 'output')).toBe(0)
  })
})

describe('stepVolume', () => {
  it('steps input by 5 and output by 10', () => {
    expect(stepVolume(50, 'up', 'input')).toBe(55)
    expect(stepVolume(50, 'down', 'input')).toBe(45)
    expect(stepVolume(50, 'up', 'output')).toBe(60)
    expect(stepVolume(50, 'down', 'output')).toBe(40)
  })

  it('does not step below the minimum or above the maximum', () => {
    expect(stepVolume(3, 'down', 'input')).toBe(0)
    expect(stepVolume(98, 'up', 'input')).toBe(100)
    expect(stepVolume(195, 'up', 'output')).toBe(200)
    expect(stepVolume(5, 'down', 'output')).toBe(0)
  })
})
