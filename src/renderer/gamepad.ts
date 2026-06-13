import type { NavAction } from './navigation'
import { stepRepeat, initialRepeatState, type RepeatState } from './auto-repeat'

export type InputAction =
  | { type: 'nav'; action: NavAction }
  | { type: 'join' }
  | { type: 'disconnect' }
  | { type: 'toggleMute' }
  | { type: 'toggleDeafen' }
  | { type: 'toggleFavorite' }
  | { type: 'toggleVisibility' }
  | { type: 'minimize' }
  | { type: 'zoom'; direction: 'in' | 'out' | 'reset' }

export type InputHandler = (action: InputAction) => void

const STICK_DEADZONE = 0.5

// Standard gamepad mapping button indices.
const BUTTON_DPAD_UP = 12
const BUTTON_DPAD_DOWN = 13
const BUTTON_LEFT_BUMPER = 4
const BUTTON_RIGHT_BUMPER = 5
const BUTTON_A = 0
const BUTTON_B = 1
const BUTTON_X = 2
const BUTTON_Y = 3
const BUTTON_LEFT_TRIGGER = 6
const BUTTON_RIGHT_TRIGGER = 7
const BUTTON_START = 9
// Right-stick click. Too easy to hit by accident on its own, but paired with LB
// it's a deliberate chord — and it dodges the LB+RB combo that games lean on.
const BUTTON_R3 = 11

const AXIS_LEFT_STICK_Y = 1

/** Polls connected gamepads on each animation frame, firing `onAction` on button-press edges. */
export function startGamepadLoop(onAction: InputHandler): () => void {
  let stopped = false
  const wasPressed = new Map<string, boolean>()
  const stickDirection = new Map<number, 'up' | 'down' | null>()
  const stickRepeat = new Map<number, RepeatState>()

  function fireOnPress(gamepad: Gamepad, buttonIndex: number, action: InputAction): void {
    const key = `${gamepad.index}:${buttonIndex}`
    const isPressed = gamepad.buttons[buttonIndex]?.pressed ?? false
    if (isPressed && !wasPressed.get(key)) onAction(action)
    wasPressed.set(key, isPressed)
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
    const prev = sameDirection ? stickRepeat.get(gamepad.index) ?? initialRepeatState : initialRepeatState
    stickDirection.set(gamepad.index, direction)

    const { state, fire } = stepRepeat(prev, true, now)
    stickRepeat.set(gamepad.index, state)
    if (fire) onAction({ type: 'nav', action: direction === 'up' ? 'UP' : 'DOWN' })
  }

  function poll(): void {
    if (stopped) return

    const now = performance.now()
    for (const gamepad of navigator.getGamepads()) {
      if (!gamepad) continue

      fireOnPress(gamepad, BUTTON_DPAD_UP, { type: 'nav', action: 'UP' })
      fireOnPress(gamepad, BUTTON_DPAD_DOWN, { type: 'nav', action: 'DOWN' })
      fireOnPress(gamepad, BUTTON_LEFT_BUMPER, { type: 'nav', action: 'GROUP_PREV' })
      fireOnPress(gamepad, BUTTON_RIGHT_BUMPER, { type: 'nav', action: 'GROUP_NEXT' })
      fireOnPress(gamepad, BUTTON_A, { type: 'join' })
      fireOnPress(gamepad, BUTTON_B, { type: 'disconnect' })
      fireOnPress(gamepad, BUTTON_X, { type: 'toggleMute' })
      fireOnPress(gamepad, BUTTON_Y, { type: 'toggleDeafen' })
      fireOnPress(gamepad, BUTTON_LEFT_TRIGGER, { type: 'zoom', direction: 'out' })
      fireOnPress(gamepad, BUTTON_RIGHT_TRIGGER, { type: 'zoom', direction: 'in' })
      fireOnPress(gamepad, BUTTON_START, { type: 'toggleFavorite' })

      // LB + R3 together = show/hide the window — the single window toggle. A
      // deliberate two-button chord that won't happen by accident, and it
      // sidesteps the LB+RB combo games lean on and the Guide button overlays
      // reserve. LB still fires group nav on its own — the incidental group hop
      // is invisible once the window parks. The window keeps polling the gamepad
      // while parked (backgroundThrottling is off), so the same chord brings it
      // back.
      const windowChord =
        (gamepad.buttons[BUTTON_R3]?.pressed ?? false) &&
        (gamepad.buttons[BUTTON_LEFT_BUMPER]?.pressed ?? false)
      const windowChordKey = `${gamepad.index}:windowChord`
      if (windowChord && !wasPressed.get(windowChordKey)) onAction({ type: 'minimize' })
      wasPressed.set(windowChordKey, windowChord)

      pollStick(gamepad, now)
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
  Escape: { type: 'disconnect' },
  b: { type: 'disconnect' },
  x: { type: 'toggleMute' },
  y: { type: 'toggleDeafen' },
  f: { type: 'toggleFavorite' },
  Tab: { type: 'toggleVisibility' },
  '-': { type: 'zoom', direction: 'out' },
  '=': { type: 'zoom', direction: 'in' },
  '+': { type: 'zoom', direction: 'in' },
  '0': { type: 'zoom', direction: 'reset' }
}

/** Keyboard equivalents of the gamepad mapping, for development without a controller. */
export function startKeyboardFallback(onAction: InputHandler): () => void {
  function handleKeydown(event: KeyboardEvent): void {
    const action = KEY_ACTIONS[event.key]
    if (!action) return
    event.preventDefault()
    onAction(action)
  }

  window.addEventListener('keydown', handleKeydown)
  return () => window.removeEventListener('keydown', handleKeydown)
}
