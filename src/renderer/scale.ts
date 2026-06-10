export const MIN_SCALE = 0.6
export const MAX_SCALE = 2.0
export const SCALE_STEP = 0.1

export type ScaleDirection = 'in' | 'out' | 'reset'

/**
 * Multiplier applied to the root font size so the whole rem-based UI can be
 * tuned for viewing distance (10-foot/Big Picture). Stepping is rounded to
 * avoid floating-point drift, and clamped to a sane range.
 */
export function adjustScale(current: number, direction: ScaleDirection): number {
  if (direction === 'reset') return 1
  const delta = direction === 'in' ? SCALE_STEP : -SCALE_STEP
  const next = Math.round((current + delta) * 10) / 10
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
}
