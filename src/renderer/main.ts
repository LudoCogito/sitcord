import './styles.css'
import { buildView, type Row } from './render'
import { navigate } from './navigation'
import { startGamepadLoop, startKeyboardFallback, type InputAction } from './gamepad'
import { adjustScale } from './scale'
import type { AppState } from '../shared/ipc'

// Root font size at scale 1.0; the rem-based stylesheet scales off this so the
// whole UI grows/shrinks together for 10-foot/Big Picture viewing.
const BASE_FONT_PX = 22
const SCALE_STORAGE_KEY = 'uiScale'

function loadScale(): number {
  const stored = Number(localStorage.getItem(SCALE_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : 1
}

let scale = loadScale()

function applyScale(): void {
  document.documentElement.style.fontSize = `${BASE_FONT_PX * scale}px`
  localStorage.setItem(SCALE_STORAGE_KEY, String(scale))
}

let state: AppState = {
  status: 'connecting',
  groups: [],
  currentChannelId: null,
  occupancy: {},
  favorites: [],
  muted: false,
  deafened: false
}
let selectionIndex = 0
let menuIndex = 0

// Shown when there are no channels to list (Discord not connected). These are
// controller-focusable: UP/DOWN move between them, A activates the highlighted
// one.
const MENU_ITEMS: { label: string; run: () => void }[] = [
  { label: 'Launch Discord', run: () => void window.api.launchDiscord() },
  { label: 'Retry connection', run: () => void window.api.retryConnection() }
]

function channelCount(s: AppState): number {
  return s.groups.reduce((sum, group) => sum + group.channels.length, 0)
}

function isMenuMode(): boolean {
  return channelCount(state) === 0
}

function clampMenu(): void {
  menuIndex = Math.min(Math.max(menuIndex, 0), MENU_ITEMS.length - 1)
}

function clampSelection(): void {
  const count = channelCount(state)
  selectionIndex = count === 0 ? 0 : Math.min(Math.max(selectionIndex, 0), count - 1)
}

function renderRow(row: Row): HTMLElement {
  if (row.kind === 'header') {
    const el = document.createElement('div')
    el.className = 'group-header'
    el.textContent = row.guildName
    return el
  }

  const el = document.createElement('div')
  el.className = 'channel-row'
  if (row.isSelected) el.classList.add('selected')
  if (row.isCurrent) el.classList.add('current')
  if (row.isFavorite) el.classList.add('favorite')

  const name = document.createElement('span')
  name.className = 'channel-name'
  name.textContent = row.name
  el.appendChild(name)

  // The channel you're actually in gets inline mouse controls so you can mute
  // or leave without the controller. Buttons stop propagation so they don't
  // also trigger the row's click-to-join.
  if (row.isCurrent) {
    const controls = document.createElement('div')
    controls.className = 'row-controls'

    const muteBtn = document.createElement('button')
    muteBtn.className = 'row-btn'
    muteBtn.textContent = state.muted ? 'Unmute' : 'Mute'
    muteBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      void window.api.setMute(!state.muted)
    })

    const leaveBtn = document.createElement('button')
    leaveBtn.className = 'row-btn row-btn--leave'
    leaveBtn.textContent = 'Leave'
    leaveBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      void window.api.disconnect()
    })

    controls.append(muteBtn, leaveBtn)
    el.appendChild(controls)
  }

  const occupancy = document.createElement('span')
  occupancy.className = 'channel-occupancy'
  occupancy.textContent = String(row.occupancy)
  el.appendChild(occupancy)

  return el
}

function renderMenu(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'menu'

  const message = document.createElement('div')
  message.className = 'menu-message'
  message.textContent =
    state.status === 'connecting' ? 'Connecting to Discord…' : "Can't reach Discord"
  wrap.appendChild(message)

  const hint = document.createElement('div')
  hint.className = 'menu-hint'
  hint.textContent = 'Make sure the Discord desktop app is running and signed in.'
  wrap.appendChild(hint)

  clampMenu()
  MENU_ITEMS.forEach((item, i) => {
    const button = document.createElement('div')
    button.className = 'menu-button'
    if (i === menuIndex) button.classList.add('selected')
    button.textContent = item.label
    button.addEventListener('click', () => {
      menuIndex = i
      item.run()
      render()
    })
    wrap.appendChild(button)
  })

  return wrap
}

function render(): void {
  clampSelection()

  const app = document.getElementById('app')
  if (!app) return

  app.innerHTML = ''

  const status = document.createElement('div')
  status.className = `status status--${state.status}`
  status.textContent = state.status
  app.appendChild(status)

  const legend = document.createElement('div')
  legend.className = 'legend'

  if (isMenuMode()) {
    app.appendChild(renderMenu())
    legend.textContent = 'A Select · LT/RT Zoom · R3+LB Minimize · Select+Start Show/Hide'
    app.appendChild(legend)
    return
  }

  const list = document.createElement('div')
  list.className = 'channel-list'
  let selectedEl: HTMLElement | null = null
  let channelIndex = 0
  for (const row of buildView(state, selectionIndex)) {
    const el = renderRow(row)
    if (row.kind === 'channel') {
      if (row.isSelected) selectedEl = el
      const index = channelIndex
      const channelId = row.channelId
      // Clicking a channel both moves the selection there and joins it — the
      // primary mouse action for a voice switcher.
      el.addEventListener('click', () => {
        selectionIndex = index
        void window.api.join(channelId)
        render()
      })
      channelIndex++
    }
    list.appendChild(el)
  }
  app.appendChild(list)

  // Keep the highlighted channel visible while navigating a long list with big
  // rows — essential for couch/controller use where only a few rows fit.
  selectedEl?.scrollIntoView({ block: 'nearest' })

  legend.textContent =
    'A Join · B Disconnect · X Mute · Y Deafen · Start Favorite · LT/RT Zoom · R3+LB Minimize · Select+Start Show/Hide'
  app.appendChild(legend)
}

function selectedChannelId(): string | null {
  const row = buildView(state, selectionIndex).find(
    (r): r is Row & { kind: 'channel' } => r.kind === 'channel' && r.isSelected
  )
  return row?.channelId ?? null
}

function handleAction(action: InputAction): void {
  // In menu mode (no channels / not connected) only navigation, activation,
  // zoom and show/hide apply — the rest need a live Discord connection.
  if (isMenuMode()) {
    switch (action.type) {
      case 'nav':
        if (action.action === 'UP') menuIndex--
        else if (action.action === 'DOWN') menuIndex++
        clampMenu()
        render()
        return
      case 'join':
        MENU_ITEMS[menuIndex]?.run()
        return
      case 'zoom':
        scale = adjustScale(scale, action.direction)
        applyScale()
        return
      case 'toggleVisibility':
        void window.api.toggleVisibility()
        return
      case 'minimize':
        void window.api.minimize()
        return
      default:
        return
    }
  }

  switch (action.type) {
    case 'nav': {
      const rows = buildView(state, selectionIndex)
      selectionIndex = navigate({ rows, selectionIndex }, action.action).selectionIndex
      render()
      break
    }
    case 'join': {
      const channelId = selectedChannelId()
      if (channelId) void window.api.join(channelId)
      break
    }
    case 'disconnect':
      void window.api.disconnect()
      break
    case 'toggleMute':
      void window.api.setMute(!state.muted)
      break
    case 'toggleDeafen':
      void window.api.setDeafen(!state.deafened)
      break
    case 'toggleFavorite': {
      const channelId = selectedChannelId()
      if (channelId) void window.api.toggleFavorite(channelId)
      break
    }
    case 'toggleVisibility':
      void window.api.toggleVisibility()
      break
    case 'minimize':
      void window.api.minimize()
      break
    case 'zoom':
      scale = adjustScale(scale, action.direction)
      applyScale()
      break
  }
}

window.api.onStateUpdate((next) => {
  state = next
  render()
})

startGamepadLoop(handleAction)
startKeyboardFallback(handleAction)

applyScale()
render()
