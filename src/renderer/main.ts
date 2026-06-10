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

function channelCount(s: AppState): number {
  return s.groups.reduce((sum, group) => sum + group.channels.length, 0)
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

  const occupancy = document.createElement('span')
  occupancy.className = 'channel-occupancy'
  occupancy.textContent = String(row.occupancy)

  el.append(name, occupancy)
  return el
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

  const list = document.createElement('div')
  list.className = 'channel-list'
  let selectedEl: HTMLElement | null = null
  for (const row of buildView(state, selectionIndex)) {
    const el = renderRow(row)
    if (row.kind === 'channel' && row.isSelected) selectedEl = el
    list.appendChild(el)
  }
  app.appendChild(list)

  // Keep the highlighted channel visible while navigating a long list with big
  // rows — essential for couch/controller use where only a few rows fit.
  selectedEl?.scrollIntoView({ block: 'nearest' })

  const legend = document.createElement('div')
  legend.className = 'legend'
  legend.textContent = 'A Join · B Disconnect · X Mute · Y Deafen · Start Favorite · LT/RT Zoom'
  app.appendChild(legend)
}

function selectedChannelId(): string | null {
  const row = buildView(state, selectionIndex).find(
    (r): r is Row & { kind: 'channel' } => r.kind === 'channel' && r.isSelected
  )
  return row?.channelId ?? null
}

function handleAction(action: InputAction): void {
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
