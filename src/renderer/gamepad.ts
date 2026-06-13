import type { NavAction } from './navigation'
import { initialComboState, stepCombo, type ComboState } from './chord'

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
const BUTTON_SELECT = 8
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
  const comboState = new Map<number, ComboState>()

  function fireOnPress(gamepad: Gamepad, buttonIndex: number, action: InputAction): void {
    const key = `${gamepad.index}:${buttonIndex}`
    const isPressed = gamepad.buttons[buttonIndex]?.pressed ?? false
    if (isPressed && !wasPressed.get(key)) onAction(action)
    wasPressed.set(key, isPressed)
  }

  function pollStick(gamepad: Gamepad): void {
    const y = gamepad.axes[AXIS_LEFT_STICK_Y] ?? 0
    const previous = stickDirection.get(gamepad.index) ?? null

    if (y < -STICK_DEADZONE) {
      if (previous !== 'up') onAction({ type: 'nav', action: 'UP' })
      stickDirection.set(gamepad.index, 'up')
    } else if (y > STICK_DEADZONE) {
      if (previous !== 'down') onAction({ type: 'nav', action: 'DOWN' })
      stickDirection.set(gamepad.index, 'down')
    } else {
      stickDirection.set(gamepad.index, null)
    }
  }

  function poll(): void {
    if (stopped) return

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

      // R3 + LB together = minimize (a deliberate two-button chord that won't
      // happen by accident; distinct from the Select+Start show/hide chord, and
      // sidesteps the LB+RB combo games lean on and the Guide button overlays
      // reserve). LB still fires group nav on its own — the incidental group hop
      // is invisible once the window parks. Restore comes from the global hotkey
      // or tray, since a minimized window stops polling the gamepad.
      const minimizeChord =
        (gamepad.buttons[BUTTON_R3]?.pressed ?? false) &&
        (gamepad.buttons[BUTTON_LEFT_BUMPER]?.pressed ?? false)
      const minimizeChordKey = `${gamepad.index}:minimizeChord`
      if (minimizeChord && !wasPressed.get(minimizeChordKey)) onAction({ type: 'minimize' })
      wasPressed.set(minimizeChordKey, minimizeChord)

      // Select+Start chord toggles window visibility (present on every
      // controller, hard to fumble); Start alone = Favorite. stepCombo handles
      // the timing so a Start-then-Select roll within the grace window is read
      // as the chord rather than a stray Favorite.
      const selectPressed = gamepad.buttons[BUTTON_SELECT]?.pressed ?? false
      const startPressed = gamepad.buttons[BUTTON_START]?.pressed ?? false
      const prevCombo = comboState.get(gamepad.index) ?? initialComboState
      const combo = stepCombo(prevCombo, { selectPressed, startPressed, now: performance.now() })
      comboState.set(gamepad.index, combo.state)
      if (combo.toggleVisibility) onAction({ type: 'toggleVisibility' })
      if (combo.toggleFavorite) onAction({ type: 'toggleFavorite' })

      pollStick(gamepad)
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
