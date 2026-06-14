import './styles.css'
import { buildView, type Row } from './render'
import { navigate } from './navigation'
import { startGamepadLoop, startKeyboardFallback, type InputAction } from './gamepad'
import { adjustScale } from './scale'
import { buildLegend, settingsChip, detectController, type ControllerKind } from './controller-profile'
import type { AppState } from '../shared/ipc'

// Root font size at scale 1.0; the rem-based stylesheet scales off this so the
// whole UI grows/shrinks together for 10-foot/Big Picture viewing.
const BASE_FONT_PX = 22
const SCALE_STORAGE_KEY = 'uiScale'

// Shown on the left of the titlebar. Keep in sync with package.json productName.
const APP_NAME = 'Sitcord'

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

// Whether the bottom settings/help drawer is open. The bottom bar otherwise
// shows just the single "Settings" chip; this drawer holds the full control
// list (and is where future optional settings live).
let helpOpen = false

// Which row index currently carries the `.selected` highlight in the live DOM.
// Lets a pure selection move relocate the highlight in place (moveSelection)
// instead of rebuilding the whole list — the rebuild was firing ~35x/sec during
// accelerating stick-scroll and was the source of the lag. -1 = no list in DOM.
let domSelectionIndex = -1

// Which server groups are collapsed (their channels hidden), keyed by guildId.
// Persisted renderer-side like the zoom scale, so it survives reloads with no
// main-process plumbing.
const COLLAPSED_STORAGE_KEY = 'collapsedGuilds'

function loadCollapsed(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

const collapsed = loadCollapsed()

function toggleCollapse(guildId: string): void {
  if (collapsed.has(guildId)) collapsed.delete(guildId)
  else collapsed.add(guildId)
  localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]))
}

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
  // Selection indexes the visible rows (headers + non-collapsed channels).
  const count = buildView(state, 0, collapsed).length
  selectionIndex = count === 0 ? 0 : Math.min(Math.max(selectionIndex, 0), count - 1)
}

// Discord-style acronym for iconless servers: the initial of each word.
function guildAcronym(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

function guildAcronymTile(name: string): HTMLElement {
  const tile = document.createElement('span')
  tile.className = 'group-icon group-icon--fallback'
  tile.textContent = guildAcronym(name)
  return tile
}

function renderRow(row: Row): HTMLElement {
  if (row.kind === 'header') {
    const el = document.createElement('div')
    el.className = 'group-header'
    if (row.isSelected) el.classList.add('selected')
    if (row.isCollapsed) el.classList.add('collapsed')

    // Server icon sits just left of the name. Discord gives a CDN url, or none
    // for iconless servers — those fall back to an acronym tile like Discord's.
    if (row.iconUrl) {
      const icon = document.createElement('img')
      icon.className = 'group-icon'
      icon.src = row.iconUrl
      icon.alt = ''
      // If the image fails to load, swap in the acronym fallback.
      icon.addEventListener('error', () => icon.replaceWith(guildAcronymTile(row.guildName)))
      el.appendChild(icon)
    } else {
      el.appendChild(guildAcronymTile(row.guildName))
    }

    const name = document.createElement('span')
    name.className = 'group-name'
    name.textContent = row.guildName
    el.appendChild(name)

    // While collapsed, show how many channels are hidden so the group still
    // reads as "there's stuff in here".
    const count = document.createElement('span')
    count.className = 'group-count'
    count.textContent = row.isCollapsed ? String(row.channelCount) : ''
    el.appendChild(count)

    // Collapse/expand chevron now sits at the right edge (name flex-grows to
    // push it there), rather than to the left of the server name.
    const chevron = document.createElement('span')
    chevron.className = 'group-chevron'
    chevron.textContent = row.isCollapsed ? '▸' : '▾'
    el.appendChild(chevron)

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

  // The channel you're actually in gets inline mouse controls so you can mute,
  // deafen, or leave without the controller. Buttons stop propagation so they
  // don't also trigger the row's click-to-join.
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

    const deafenBtn = document.createElement('button')
    deafenBtn.className = 'row-btn'
    deafenBtn.textContent = state.deafened ? 'Undeafen' : 'Deafen'
    deafenBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      void window.api.setDeafen(!state.deafened)
    })

    const leaveBtn = document.createElement('button')
    leaveBtn.className = 'row-btn row-btn--leave'
    leaveBtn.textContent = 'Leave'
    leaveBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      void window.api.disconnect()
    })

    controls.append(muteBtn, deafenBtn, leaveBtn)
    el.appendChild(controls)
  }

  const occupancy = document.createElement('span')
  occupancy.className = 'channel-occupancy'
  occupancy.textContent = String(row.occupancy)
  el.appendChild(occupancy)

  return el
}

// Pick the legend's glyph set from the first connected gamepad's id. With no
// controller (keyboard dev) this returns 'generic', i.e. the A/B/X/Y default.
function detectConnectedController(): ControllerKind {
  for (const gamepad of navigator.getGamepads()) {
    if (gamepad) return detectController(gamepad.id)
  }
  return 'generic'
}

// A single {icon,label} chip ([Select] Settings, etc.). Used for the lone
// bottom-bar chip and (with bigger styling) for each row of the drawer.
function makeChip(entry: { icon: string; label: string }, labelClass: string): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'legend-icon'
  icon.textContent = entry.icon

  const label = document.createElement('span')
  label.className = labelClass
  label.textContent = entry.label

  const chip = document.createElement('span')
  chip.append(icon, label)
  return chip
}

// The bottom bar is now a single clean row: just the Select button mapped to
// "Settings" (→ "Close" while open), which toggles the drawer. The bar stays a
// drag region; the chip opts out so it's clickable.
function renderLegend(): HTMLElement {
  const legend = document.createElement('div')
  legend.className = 'legend'

  const kind = detectConnectedController()
  const chip = makeChip(settingsChip(kind, helpOpen), 'legend-label')
  chip.className = 'legend-chip legend-chip--button'
  chip.addEventListener('click', () => {
    helpOpen = !helpOpen
    render()
  })

  legend.appendChild(chip)
  return legend
}

// The settings/help drawer: a bottom-anchored panel (over a dim backdrop)
// listing every control one per row. Future optional settings get added to this
// same list. Clicking the backdrop closes it; clicking the panel doesn't.
function renderHelpDrawer(mode: 'menu' | 'channels'): HTMLElement {
  const backdrop = document.createElement('div')
  backdrop.className = 'help-backdrop'
  backdrop.addEventListener('click', () => {
    helpOpen = false
    render()
  })

  const panel = document.createElement('div')
  panel.className = 'help-panel'
  panel.addEventListener('click', (event) => event.stopPropagation())

  const title = document.createElement('div')
  title.className = 'help-title'
  title.textContent = 'Settings'
  panel.appendChild(title)

  const section = document.createElement('div')
  section.className = 'help-section-label'
  section.textContent = 'Controls'
  panel.appendChild(section)

  const kind = detectConnectedController()
  const listEl = document.createElement('div')
  listEl.className = 'help-list'
  for (const entry of buildLegend(kind, mode)) {
    const row = makeChip(entry, 'help-label')
    row.className = 'help-row'
    listEl.appendChild(row)
  }
  panel.appendChild(listEl)

  backdrop.appendChild(panel)
  return backdrop
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

  // Frameless titlebar: app name on the left, connection status on the right.
  const titlebar = document.createElement('div')
  titlebar.className = 'titlebar'

  const appName = document.createElement('span')
  appName.className = 'titlebar-name'
  appName.textContent = APP_NAME

  const status = document.createElement('span')
  status.className = `titlebar-status status--${state.status}`
  status.textContent = state.status

  titlebar.append(appName, status)
  app.appendChild(titlebar)

  if (isMenuMode()) {
    const content = document.createElement('div')
    content.className = 'content'
    content.appendChild(renderMenu())
    if (helpOpen) content.appendChild(renderHelpDrawer('menu'))
    app.appendChild(content)
    app.appendChild(renderLegend())
    domSelectionIndex = -1 // no channel list in the DOM
    return
  }

  const content = document.createElement('div')
  content.className = 'content'

  const list = document.createElement('div')
  list.className = 'channel-list'
  buildView(state, selectionIndex, collapsed).forEach((row, index) => {
    const el = renderRow(row)
    if (row.kind === 'header') {
      const guildId = row.guildId
      // Clicking a server header selects it and toggles its collapse.
      el.addEventListener('click', () => {
        selectionIndex = index
        toggleCollapse(guildId)
        render()
      })
    } else {
      const channelId = row.channelId
      // Clicking a channel both moves the selection there and joins it — the
      // primary mouse action for a voice switcher.
      el.addEventListener('click', () => {
        selectionIndex = index
        void window.api.join(channelId)
        render()
      })
    }
    list.appendChild(el)
  })
  content.appendChild(list)
  if (helpOpen) content.appendChild(renderHelpDrawer('channels'))
  app.appendChild(content)
  app.appendChild(renderLegend())

  // Scroll the selection into view *after* the legend is in the DOM. The list
  // is flex:1, so before the legend exists it's laid out one legend-height too
  // tall; scrolling then would park a near-bottom row where the legend lands
  // and the legend would clip it out of view. Keeping the highlighted row
  // visible matters most for couch/controller use where only a few rows fit.
  // (Skip while the drawer covers the list.)
  if (!helpOpen) list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  domSelectionIndex = selectionIndex // DOM highlight now matches the selection
}

// Light-weight selection move: relocate the `.selected` highlight between the
// already-rendered rows instead of tearing down and rebuilding the whole list.
// Falls back to a full render if the list isn't in the DOM (menu mode, etc.).
function moveSelection(): void {
  const list = document.querySelector<HTMLElement>('.channel-list')
  if (!list || list.children.length === 0) {
    render()
    return
  }
  clampSelection()
  if (selectionIndex === domSelectionIndex) return

  list.children[domSelectionIndex]?.classList.remove('selected')
  const next = list.children[selectionIndex]
  if (next) {
    next.classList.add('selected')
    next.scrollIntoView({ block: 'nearest' })
  }
  domSelectionIndex = selectionIndex
}

function selectedRow(): Row | null {
  return buildView(state, selectionIndex, collapsed)[selectionIndex] ?? null
}

function handleAction(action: InputAction): void {
  // Settings/help drawer takes priority: Select toggles it from anywhere, and
  // while it's open the only other input that does anything is B/Esc (close),
  // so it acts as a modal layer over the channel list.
  if (action.type === 'toggleHelp') {
    helpOpen = !helpOpen
    render()
    return
  }
  if (helpOpen) {
    if (action.type === 'disconnect') {
      helpOpen = false
      render()
    }
    return
  }

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
      const rows = buildView(state, selectionIndex, collapsed)
      selectionIndex = navigate({ rows, selectionIndex }, action.action).selectionIndex
      moveSelection() // just relocate the highlight; no full rebuild
      break
    }
    case 'join': {
      // A on a server header collapses/expands it; on a channel it joins.
      const row = selectedRow()
      if (row?.kind === 'header') {
        toggleCollapse(row.guildId)
        render()
      } else if (row?.kind === 'channel') {
        void window.api.join(row.channelId)
      }
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
      const row = selectedRow()
      if (row?.kind === 'channel') void window.api.toggleFavorite(row.channelId)
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

// Re-render so the legend adopts the glyphs of whatever just (dis)connected.
window.addEventListener('gamepadconnected', render)
window.addEventListener('gamepaddisconnected', render)

applyScale()
render()
