// Pure volume math shared by the main process (service: defensive clamp before
// the SET_VOICE_SETTINGS RPC) and the renderer (gamepad shortcuts turn a
// relative up/down into an absolute value; the slider clamps drag input). Kept
// free of DOM/Electron so it's unit-testable on its own.
//
// Discord's voice settings use distinct ranges: input (mic) is 0–100, output
// (everyone else) is 0–200. Step sizes give each ~20 notches across its range.

export type VolumeTarget = 'input' | 'output'

export interface VolumeRange {
  min: number
  max: number
  /** Increment for one shortcut press / slider tick. */
  step: number
}

export const VOLUME_RANGES: Record<VolumeTarget, VolumeRange> = {
  input: { min: 0, max: 100, step: 5 },
  output: { min: 0, max: 200, step: 10 }
}

/** Clamp to the target's range and round to an integer. Non-finite → minimum. */
export function clampVolume(value: number, target: VolumeTarget): number {
  const { min, max } = VOLUME_RANGES[target]
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Move `current` one step in `direction`, clamped to the target's range. */
export function stepVolume(
  current: number,
  direction: 'up' | 'down',
  target: VolumeTarget
): number {
  const { step } = VOLUME_RANGES[target]
  return clampVolume(current + (direction === 'up' ? step : -step), target)
}
