import type { NavAction } from './navigation'
import { stepRepeat, initialRepeatState, type RepeatState } from './auto-repeat'
import type { VolumeTarget } from '../shared/volume'

export type InputAction =
  | { type: 'nav'; action: NavAction }
  | { type: 'join' }
  | { type: 'pickup' }
  | { type: 'disconnect' }
  | { type: 'toggleMute' }
  | { type: 'toggleDeafen' }
  | { type: 'toggleFavorite' }
  | { type: 'toggleVisibility' }
  | { type: 'minimize' }
  | { type: 'toggleHelp' }
  | { type: 'zoom'; direction: 'in' | 'out' | 'reset' }
  | { type: 'adjustVolume'; target: VolumeTarget; direction: 'up' | 'down' }

export type InputHandler = (action: InputAction) => void

const STICK_DEADZONE = 0.5
// Hold A past this to "pick up" the selected server for reordering; a shorter
// press is the normal tap (join / collapse).
const LONG_PRESS_MS = 400

// Standard gamepad mapping button indices.
const BUTTON_DPAD_UP = 12
const BUTTON_DPAD_DOWN = 13
const BUTTON_DPAD_LEFT = 14
const BUTTON_DPAD_RIGHT = 15
const BUTTON_LEFT_BUMPER = 4
const BUTTON_RIGHT_BUMPER = 5
const BUTTON_A = 0
const BUTTON_B = 1
const BUTTON_X = 2
const BUTTON_Y = 3
const BUTTON_LEFT_TRIGGER = 6
const BUTTON_RIGHT_TRIGGER = 7
// Back/View/Share (PlayStation "Create") button — opens the settings drawer.
const BUTTON_SELECT = 8
const BUTTON_START = 9
// Right-stick click. Too easy to hit by accident on its own, but paired with LB
// it's a deliberate chord — and it dodges the LB+RB combo that games lean on.
const BUTTON_R3 = 11

const AXIS_LEFT_STICK_Y = 1

/** Whether a button is currently held, tolerating a short/sparse buttons array. */
function pressed(gamepad: Gamepad, buttonIndex: number): boolean {
  return gamepad.buttons[buttonIndex]?.pressed ?? false
}

/** Polls connected gamepads on each animation frame, firing `onAction` on button-press edges. */
export function startGamepadLoop(
  onAction: InputHandler,
  onError?: (err: unknown) => void
): () => void {
  let stopped = false
  const wasPressed = new Map<string, boolean>()
  const stickDirection = new Map<number, 'up' | 'down' | null>()
  const stickRepeat = new Map<number, RepeatState>()
  const holdState = new Map<string, { pressedAt: number; firedLong: boolean }>()
  // Per-bumper hold tracking. `consumed` flips true once the hold is used as a
  // volume modifier (or the window chord), so its release no longer fires group
  // nav. Repeat/lastDir drive the accelerating volume ramp while a bumper +
  // d-pad ◀/▶ is held.
  const bumperHold = new Map<string, { consumed: boolean }>()
  const bumperRepeat = new Map<string, RepeatState>()
  const bumperDir = new Map<string, 'up' | 'down' | null>()

  function fireOnPress(gamepad: Gamepad, buttonIndex: number, action: InputAction): void {
    const key = `${gamepad.index}:${buttonIndex}`
    const isPressed = pressed(gamepad, buttonIndex)
    if (isPressed && !wasPressed.get(key)) onAction(action)
    wasPressed.set(key, isPressed)
  }

  // Distinguishes a tap from a hold. The long action fires once the moment the
  // hold threshold is crossed (so it feels responsive while still held); the tap
  // action fires on release, but only if the long action didn't already fire.
  function fireTapOrHold(
    gamepad: Gamepad,
    buttonIndex: number,
    now: number,
    tap: InputAction,
    hold: InputAction
  ): void {
    const key = `${gamepad.index}:${buttonIndex}`
    const isPressed = pressed(gamepad, buttonIndex)
    const prev = holdState.get(key)

    if (isPressed && !prev) {
      holdState.set(key, { pressedAt: now, firedLong: false })
    } else if (isPressed && prev && !prev.firedLong && now - prev.pressedAt >= LONG_PRESS_MS) {
      onAction(hold)
      prev.firedLong = true
    } else if (!isPressed && prev) {
      if (!prev.firedLong) onAction(tap)
      holdState.delete(key)
    }
  }

  // Holding the stick auto-repeats with acceleration (fire, pause, then ramp
  // from slow to fast) so a long channel list scrolls quickly. Flipping the
  // stick to the opposite direction restarts the ramp so the new direction
  // fires at once.
  function pollStick(gamepad: Gamepad, now: number): void {
    const y = gamepad.axes[AXIS_LEFT_STICK_Y] ?? 0
    const direction = y < -STICK_DEADZONE ? 'up' : y > STICK_DEADZONE ? 'down' : null

    if (direction === null) {
      stickDirection.set(gamepad.index, null)
      stickRepeat.set(gamepad.index, initialRepeatState)
      return
    }

    const sameDirection = direction === (stickDirection.get(gamepad.index) ?? null)
    const prev = sameDirection
      ? (stickRepeat.get(gamepad.index) ?? initialRepeatState)
      : initialRepeatState
    stickDirection.set(gamepad.index, direction)

    const { state, fire } = stepRepeat(prev, true, now)
    stickRepeat.set(gamepad.index, state)
    if (fire) onAction({ type: 'nav', action: direction === 'up' ? 'UP' : 'DOWN' })
  }

  // A bumper doubles as a volume modifier: held with d-pad ◀/▶ it adjusts a
  // volume (LB = mic/input, RB = Discord/output) with the same accelerating
  // auto-repeat as the stick. Group nav (its solo action) fires on *release*,
  // and only if the hold wasn't used as a modifier — so reaching for volume
  // doesn't also hop servers. Flipping ◀↔▶ restarts the ramp.
  function pollBumper(
    gamepad: Gamepad,
    now: number,
    bumperButton: number,
    target: VolumeTarget,
    navAction: NavAction
  ): void {
    const key = `${gamepad.index}:${bumperButton}`
    const isPressed = pressed(gamepad, bumperButton)
    const prev = bumperHold.get(key)

    if (!isPressed) {
      if (prev) {
        if (!prev.consumed) onAction({ type: 'nav', action: navAction })
        bumperHold.delete(key)
        bumperRepeat.delete(key)
        bumperDir.delete(key)
      }
      return
    }

    const hold = prev ?? { consumed: false }
    if (!prev) bumperHold.set(key, hold)

    const left = pressed(gamepad, BUTTON_DPAD_LEFT)
    const right = pressed(gamepad, BUTTON_DPAD_RIGHT)
    const direction = right ? 'up' : left ? 'down' : null

    if (direction === null) {
      bumperRepeat.set(key, initialRepeatState)
      bumperDir.set(key, null)
      return
    }

    hold.consumed = true
    const sameDirection = direction === (bumperDir.get(key) ?? null)
    const base = sameDirection ? (bumperRepeat.get(key) ?? initialRepeatState) : initialRepeatState
    bumperDir.set(key, direction)
    const { state, fire } = stepRepeat(base, true, now)
    bumperRepeat.set(key, state)
    if (fire) onAction({ type: 'adjustVolume', target, direction })
  }

  function poll(): void {
    if (stopped) return

    try {
      const now = performance.now()
      for (const gamepad of navigator.getGamepads()) {
        if (!gamepad) continue

        fireOnPress(gamepad, BUTTON_DPAD_UP, { type: 'nav', action: 'UP' })
        fireOnPress(gamepad, BUTTON_DPAD_DOWN, { type: 'nav', action: 'DOWN' })
        // Bumpers: solo tap = group nav (on release); held + d-pad ◀/▶ = volume.
        pollBumper(gamepad, now, BUTTON_LEFT_BUMPER, 'input', 'GROUP_PREV')
        pollBumper(gamepad, now, BUTTON_RIGHT_BUMPER, 'output', 'GROUP_NEXT')
        // A taps to join/collapse; held, it picks up the selected server to reorder.
        fireTapOrHold(gamepad, BUTTON_A, now, { type: 'join' }, { type: 'pickup' })
        fireOnPress(gamepad, BUTTON_B, { type: 'disconnect' })
        fireOnPress(gamepad, BUTTON_X, { type: 'toggleMute' })
        fireOnPress(gamepad, BUTTON_Y, { type: 'toggleDeafen' })
        fireOnPress(gamepad, BUTTON_LEFT_TRIGGER, { type: 'zoom', direction: 'out' })
        fireOnPress(gamepad, BUTTON_RIGHT_TRIGGER, { type: 'zoom', direction: 'in' })
        fireOnPress(gamepad, BUTTON_START, { type: 'toggleFavorite' })
        fireOnPress(gamepad, BUTTON_SELECT, { type: 'toggleHelp' })

        // LB + R3 together = show/hide the window — the single window toggle. A
        // deliberate two-button chord that won't happen by accident, and it
        // sidesteps the LB+RB combo games lean on and the Guide button overlays
        // reserve. LB still fires group nav on its own — the incidental group hop
        // is invisible once the window parks. The window keeps polling the gamepad
        // while parked (backgroundThrottling is off), so the same chord brings it
        // back.
        const windowChord = pressed(gamepad, BUTTON_R3) && pressed(gamepad, BUTTON_LEFT_BUMPER)
        const windowChordKey = `${gamepad.index}:windowChord`
        if (windowChord && !wasPressed.get(windowChordKey)) onAction({ type: 'minimize' })
        wasPressed.set(windowChordKey, windowChord)
        // Using LB in the window chord consumes its hold so releasing it doesn't
        // also fire a stray group-nav (the chord's whole point is to be invisible).
        if (windowChord) {
          const lbHold = bumperHold.get(`${gamepad.index}:${BUTTON_LEFT_BUMPER}`)
          if (lbHold) lbHold.consumed = true
        }

        pollStick(gamepad, now)
      }
    } catch (err) {
      // The rAF loop is dead once a frame throws; stop it and surface the crash
      // rather than spinning on the same error every frame.
      stopped = true
      onError?.(err)
      return
    }

    requestAnimationFrame(poll)
  }

  requestAnimationFrame(poll)

  return () => {
    stopped = true
  }
}

const KEY_ACTIONS: Record<string, InputAction> = {
  ArrowUp: { type: 'nav', action: 'UP' },
  ArrowDown: { type: 'nav', action: 'DOWN' },
  ArrowLeft: { type: 'nav', action: 'GROUP_PREV' },
  ArrowRight: { type: 'nav', action: 'GROUP_NEXT' },
  Enter: { type: 'join' },
  a: { type: 'join' },
  // Keyboard stand-in for "hold A" (long-press is awkward on a keyboard): grabs
  // the selected server for reordering.
  g: { type: 'pickup' },
  Escape: { type: 'disconnect' },
  b: { type: 'disconnect' },
  x: { type: 'toggleMute' },
  y: { type: 'toggleDeafen' },
  f: { type: 'toggleFavorite' },
  h: { type: 'toggleHelp' },
  Tab: { type: 'toggleVisibility' },
  '-': { type: 'zoom', direction: 'out' },
  '=': { type: 'zoom', direction: 'in' },
  '+': { type: 'zoom', direction: 'in' },
  '0': { type: 'zoom', direction: 'reset' },
  // Volume (keyboard stand-ins for LB/RB + d-pad ◀/▶): mic on [ ], Discord on ; '
  '[': { type: 'adjustVolume', target: 'input', direction: 'down' },
  ']': { type: 'adjustVolume', target: 'input', direction: 'up' },
  ';': { type: 'adjustVolume', target: 'output', direction: 'down' },
  "'": { type: 'adjustVolume', target: 'output', direction: 'up' }
}

/** Keyboard equivalents of the gamepad mapping, for development without a controller. */
export function startKeyboardFallback(
  onAction: InputHandler,
  onError?: (err: unknown) => void
): () => void {
  function handleKeydown(event: KeyboardEvent): void {
    const action = KEY_ACTIONS[event.key]
    if (!action) return
    event.preventDefault()
    try {
      onAction(action)
    } catch (err) {
      onError?.(err)
    }
  }

  window.addEventListener('keydown', handleKeydown)
  return () => window.removeEventListener('keydown', handleKeydown)
}
