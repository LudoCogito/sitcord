// Rising-edge detection for a held button combination (e.g. Select+Start).
// Pure so the gamepad loop's chord handling can be unit-tested without a real
// controller. The combo fires once when both buttons first go down together,
// and re-arms only after they are released.
export interface ChordState {
  held: boolean
}

export const initialChordState: ChordState = { held: false }

export function stepChord(
  prev: ChordState,
  bothPressed: boolean
): { state: ChordState; fired: boolean } {
  const fired = bothPressed && !prev.held
  return { state: { held: bothPressed }, fired }
}
