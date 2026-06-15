// Pure mapping from a connected gamepad's `id` string to a set of button
// glyphs and an on-screen legend. Kept pure (no DOM, no navigator) so detection
// and the per-controller labelling can be unit-tested without a real gamepad.
//
// The Gamepad API only gives us the free-form `id` string, so detection is
// best-effort string matching on the well-known names/vendor ids. Anything we
// can't place falls back to the generic (Xbox-style A/B/X/Y) layout, which is
// also what we show with no controller connected.

export type ControllerKind = 'xbox' | 'playstation' | 'steam' | 'generic'

export interface ButtonGlyphs {
  a: string
  b: string
  x: string
  y: string
  start: string
  select: string
  lb: string
  rb: string
  lt: string
  rt: string
  r3: string
}

export interface LegendEntry {
  /** Short glyph(s) for the button(s), e.g. "A", "✕", "LT/RT", "R3+LB". */
  icon: string
  label: string
}

const STEAM = /steam|valve|28de/i
// DualSense/DualShock by name, "Sony"/"PlayStation", or the Sony vendor id 054c.
const PLAYSTATION = /dualsense|dualshock|playstation|\bsony\b|\b054c\b/i
const XBOX = /xbox|x-box|xinput|\b045e\b/i

export function detectController(id: string): ControllerKind {
  // Order matters: a real Steam Controller reports "Steam", so check it before
  // the Xbox match (Steam *Input* virtual pads emulate Xbox and are fine to
  // treat as such).
  if (STEAM.test(id)) return 'steam'
  if (PLAYSTATION.test(id)) return 'playstation'
  if (XBOX.test(id)) return 'xbox'
  return 'generic'
}

const FACE_LETTERS: ButtonGlyphs = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  start: 'Start',
  select: 'Select',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  r3: 'R3'
}

const PLAYSTATION_GLYPHS: ButtonGlyphs = {
  a: '✕',
  b: '○',
  x: '□',
  y: '△',
  start: 'Options',
  select: 'Create',
  lb: 'L1',
  rb: 'R1',
  lt: 'L2',
  rt: 'R2',
  r3: 'R3'
}

export function glyphsFor(kind: ControllerKind): ButtonGlyphs {
  return kind === 'playstation' ? PLAYSTATION_GLYPHS : FACE_LETTERS
}

/**
 * The bottom-row legend as discrete {icon,label} chips so the renderer can lay
 * them out (and wrap) cleanly instead of cramming one long string. `channels`
 * is the full voice list; `menu` is the connect/retry screen with no live
 * connection.
 */
export function buildLegend(kind: ControllerKind, mode: 'menu' | 'channels'): LegendEntry[] {
  const g = glyphsFor(kind)
  const zoom = { icon: `${g.lt}/${g.rt}`, label: 'Zoom' }
  const showHide = { icon: `${g.lb}+${g.r3}`, label: 'Show/Hide' }

  if (mode === 'menu') {
    return [{ icon: g.a, label: 'Select' }, zoom, showHide]
  }

  return [
    { icon: g.a, label: 'Join' },
    { icon: g.b, label: 'Disconnect' },
    { icon: g.x, label: 'Mute' },
    { icon: g.y, label: 'Deafen' },
    // Hold a bumper and tap the d-pad left/right to slide the mic / Discord
    // volume; the bumper on its own still hops between servers.
    { icon: `${g.lb} ◀▶`, label: 'Mic volume' },
    { icon: `${g.rb} ◀▶`, label: 'Discord volume' },
    // Hold the same button as Join: on a server header it picks the server up to
    // reorder it (Up/Down to move, press again to drop).
    { icon: g.a, label: 'Hold: reorder server' },
    { icon: g.start, label: 'Favorite' },
    zoom,
    showHide
  ]
}

/**
 * The single chip shown in the (otherwise empty) bottom bar: the Select button
 * opens the settings/help drawer that holds the full control list. Reads
 * "Close" while that drawer is open so the same button dismisses it.
 */
export function settingsChip(kind: ControllerKind, open: boolean): LegendEntry {
  const g = glyphsFor(kind)
  return { icon: g.select, label: open ? 'Close' : 'Settings' }
}
