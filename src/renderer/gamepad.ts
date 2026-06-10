import type { NavAction } from './navigation'

export type InputAction =
  | { type: 'nav'; action: NavAction }
  | { type: 'join' }
  | { type: 'disconnect' }
  | { type: 'toggleMute' }
  | { type: 'toggleDeafen' }
  | { type: 'toggleFavorite' }
  | { type: 'toggleVisibility' }

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
const BUTTON_SELECT = 8
const BUTTON_START = 9

const AXIS_LEFT_STICK_Y = 1

/** Polls connected gamepads on each animation frame, firing `onAction` on button-press edges. */
export function startGamepadLoop(onAction: InputHandler): () => void {
  let stopped = false
  const wasPressed = new Map<string, boolean>()
  const stickDirection = new Map<number, 'up' | 'down' | null>()

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
      fireOnPress(gamepad, BUTTON_START, { type: 'toggleFavorite' })
      fireOnPress(gamepad, BUTTON_SELECT, { type: 'toggleVisibility' })

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
  Tab: { type: 'toggleVisibility' }
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
