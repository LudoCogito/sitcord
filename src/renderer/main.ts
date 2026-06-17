import './styles.css'
import { buildView, type Row } from './render'
import { navigate } from './navigation'
import { orderGroups, moveGuild, moveGuildRelativeTo } from './server-order'
import { startGamepadLoop, startKeyboardFallback, type InputAction } from './gamepad'
import { adjustScale } from './scale'
import {
  buildLegend,
  settingsChip,
  detectController,
  glyphsFor,
  type ControllerKind
} from './controller-profile'
import { updateIndicator } from './update-indicator'
import { stepVolume, VOLUME_RANGES, type VolumeTarget } from '../shared/volume'
import type { AppState, UpdateStatus } from '../shared/ipc'

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
  deafened: false,
  inputVolume: 100,
  outputVolume: 100
}
let selectionIndex = 0
let menuIndex = 0

// True while a volume slider is being dragged with the mouse. The native range
// input captures the pointer; a full re-render (from our own optimistic state
// push, or an unrelated occupancy update) would replace the element and abort
// the drag — so we suppress re-render while dragging and resync on release.
let volumeDragging = false

// App version / update status for the bottom-right corner of the legend bar.
// Pushed by the main process (initUpdater); defaults to unknown until then.
let updateStatus: UpdateStatus = { version: '', updateAvailable: false }

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

// Manual server order (guildIds), persisted renderer-side like collapse state.
// Applied to whatever groups the main process pushes via orderedState().
const SERVER_ORDER_STORAGE_KEY = 'serverOrder'

function loadServerOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SERVER_ORDER_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

let serverOrder = loadServerOrder()

// The guild currently "picked up" for reordering (Y on a server header), or null
// when not in reorder mode. While set, Up/Down move this server instead of
// moving the selection.
let reorderingGuildId: string | null = null

function saveServerOrder(): void {
  localStorage.setItem(SERVER_ORDER_STORAGE_KEY, JSON.stringify(serverOrder))
}

// State with its groups put into the user's manual order. Everything that reads
// groups (rendering, navigation, selection clamping) goes through this so the
// saved order is the single source of on-screen order.
function orderedState(): AppState {
  return { ...state, groups: orderGroups(state.groups, serverOrder) }
}

// Row index of a given server's header in the current (ordered) view, or -1.
function headerRowIndex(guildId: string): number {
  return buildView(orderedState(), -1, collapsed).findIndex(
    (row) => row.kind === 'header' && row.guildId === guildId
  )
}

// Mouse drag-and-drop reorder state. The guild being dragged, and the header
// currently hovered as a drop target (with which edge the drop indicator is on).
// Native HTML5 drag is inherently distinct from a click, so this coexists with
// click-to-collapse without a separate long-press gate.
let dragGuildId: string | null = null
let dropTargetEl: HTMLElement | null = null

function clearDropIndicator(): void {
  dropTargetEl?.classList.remove('drop-before', 'drop-after')
  dropTargetEl = null
}

// Wire a server header for drag (as a source) and drop (as a target). The live
// list isn't rebuilt mid-drag — that would destroy the drag source — so reorder
// happens once on drop; an inset line shows where it will land.
function wireHeaderDrag(el: HTMLElement, guildId: string): void {
  el.draggable = true

  el.addEventListener('dragstart', (event) => {
    dragGuildId = guildId
    el.classList.add('grabbed')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', guildId) // some browsers need data set
    }
  })

  el.addEventListener('dragend', () => {
    dragGuildId = null
    el.classList.remove('grabbed')
    clearDropIndicator()
  })

  el.addEventListener('dragover', (event) => {
    if (!dragGuildId || dragGuildId === guildId) return
    event.preventDefault() // mark this header as a valid drop target
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    // Drop before or after, depending on which half of the header we're over.
    const rect = el.getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    if (dropTargetEl !== el) clearDropIndicator()
    dropTargetEl = el
    el.classList.toggle('drop-before', before)
    el.classList.toggle('drop-after', !before)
  })

  el.addEventListener('dragleave', () => {
    if (dropTargetEl === el) clearDropIndicator()
  })

  el.addEventListener('drop', (event) => {
    event.preventDefault()
    const moved = dragGuildId
    // Reset drag state up front: render() below detaches this element, so its
    // dragend may not fire to do the cleanup.
    dragGuildId = null
    clearDropIndicator()
    if (!moved || moved === guildId) return
    const rect = el.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    const displayed = orderGroups(state.groups, serverOrder).map((g) => g.guildId)
    serverOrder = moveGuildRelativeTo(displayed, moved, guildId, position)
    saveServerOrder()
    selectionIndex = headerRowIndex(moved) // keep the moved server selected
    render() // rebuilds in the new order and clears all drag classes
  })
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
  const count = buildView(orderedState(), 0, collapsed).length
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

// An inline control on the active channel row, badged with the controller's
// glyph for its action (e.g. [X] Mute) so the main button paths are visible at
// a glance without opening the settings drawer. Stops propagation so the badge
// click doesn't also trigger the row's click-to-join.
function rowButton(
  glyph: string,
  label: string,
  extraClass: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = extraClass ? `row-btn ${extraClass}` : 'row-btn'

  const badge = document.createElement('span')
  badge.className = 'row-btn-glyph'
  badge.textContent = glyph

  const text = document.createElement('span')
  text.textContent = label

  btn.append(badge, text)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  return btn
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
      // Don't let the image start its own native drag — the header owns the drag.
      icon.draggable = false
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

    // Badge each button with the connected controller's glyph for that action
    // (X mute / Y deafen / B disconnect on Xbox; □ ○ etc. on PlayStation).
    const g = glyphsFor(detectConnectedController())

    const muteBtn = rowButton(
      g.x,
      state.muted ? 'Unmute' : 'Mute',
      '',
      () => void window.api.setMute(!state.muted)
    )
    const deafenBtn = rowButton(
      g.y,
      state.deafened ? 'Undeafen' : 'Deafen',
      '',
      () => void window.api.setDeafen(!state.deafened)
    )
    const leaveBtn = rowButton(g.b, 'Leave', 'row-btn--leave', () => void window.api.disconnect())

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

// Minimalist line-art icons, drawn as inline SVG so there's no icon-library
// dependency or license to track — these are our own paths. 24x24 viewBox,
// `currentColor` stroke so CSS drives the color (incl. the muted/--danger state).
const SVG_NS = 'http://www.w3.org/2000/svg'

function svgChild(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function svgIcon(children: SVGElement[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const c of children) svg.appendChild(c)
  return svg
}

// Mic capsule + cradle arc + stand; `off` adds the diagonal slash (muted).
function micIcon(off: boolean): SVGSVGElement {
  const parts = [
    svgChild('rect', { x: '9', y: '3', width: '6', height: '11', rx: '3' }),
    svgChild('path', { d: 'M5 11a7 7 0 0 0 14 0' }),
    svgChild('line', { x1: '12', y1: '18', x2: '12', y2: '21' }),
    svgChild('line', { x1: '8', y1: '21', x2: '16', y2: '21' })
  ]
  if (off) parts.push(svgChild('line', { x1: '3', y1: '3', x2: '21', y2: '21' }))
  return svgIcon(parts)
}

// Headband arc + two earcups; `off` adds the diagonal slash (deafened).
function headphonesIcon(off: boolean): SVGSVGElement {
  const parts = [
    svgChild('path', { d: 'M4 14v-2a8 8 0 0 1 16 0v2' }),
    svgChild('rect', { x: '2.5', y: '13.5', width: '4', height: '6.5', rx: '1.5' }),
    svgChild('rect', { x: '17.5', y: '13.5', width: '4', height: '6.5', rx: '1.5' })
  ]
  if (off) parts.push(svgChild('line', { x1: '3', y1: '3', x2: '21', y2: '21' }))
  return svgIcon(parts)
}

// One always-visible volume row: a clickable status icon (mic = mute on the
// input row, headphones = deafen on the output row), a full-width draggable
// slider, the numeric value, and the controller shortcut hint. Kept out of the
// scrolling channel list (the bar is fixed between the list and the legend) so
// it's reachable without scrolling — the controller drives volume via the
// bumper + d-pad chord and mute/deafen via X/Y; the mouse via slider + icon.
function volumeControl(target: VolumeTarget, hint: string, value: number): HTMLElement {
  const { min, max, step } = VOLUME_RANGES[target]

  const row = document.createElement('div')
  row.className = `volume volume--${target}`

  // The icon doubles as the mute (mic) / deafen (headphones) toggle.
  const isOff = target === 'input' ? state.muted : state.deafened
  const icon = document.createElement('button')
  icon.type = 'button'
  icon.className = 'volume-icon'
  if (isOff) icon.classList.add('volume-icon--off')
  icon.appendChild(target === 'input' ? micIcon(state.muted) : headphonesIcon(state.deafened))
  const label =
    target === 'input'
      ? state.muted
        ? 'Unmute (X)'
        : 'Mute (X)'
      : state.deafened
        ? 'Undeafen (Y)'
        : 'Deafen (Y)'
  icon.title = label
  icon.setAttribute('aria-label', label)
  icon.addEventListener('click', () => {
    if (target === 'input') void window.api.setMute(!state.muted)
    else void window.api.setDeafen(!state.deafened)
  })

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.className = 'volume-slider'
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)
  slider.value = String(value)
  slider.setAttribute('aria-label', target === 'input' ? 'Mic volume' : 'Discord volume')

  const readout = document.createElement('span')
  readout.className = 'volume-value'
  readout.textContent = String(value)

  const hintEl = document.createElement('span')
  hintEl.className = 'volume-hint'
  hintEl.textContent = hint

  const send = target === 'input' ? window.api.setInputVolume : window.api.setOutputVolume
  slider.addEventListener('pointerdown', () => {
    volumeDragging = true
  })
  slider.addEventListener('input', () => {
    const v = Number(slider.value)
    readout.textContent = String(v)
    void send(v)
  })

  row.append(icon, slider, readout, hintEl)
  return row
}

// The fixed two-row volume panel (mic above, Discord below), shown only while
// connected. The shortcut hints adopt the connected controller's bumper glyphs.
function renderVolumeBar(): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'volume-bar'
  const g = glyphsFor(detectConnectedController())
  bar.appendChild(volumeControl('input', `${g.lb} ◀▶`, state.inputVolume))
  bar.appendChild(volumeControl('output', `${g.rb} ◀▶`, state.outputVolume))
  return bar
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
  chip.addEventListener('click', () => setHelpOpen(!helpOpen))

  legend.appendChild(chip)

  // Bottom-right corner: the running version normally, turning yellow and
  // reading "Update available" once the main process detects a newer release.
  const indicator = updateIndicator(updateStatus)
  if (indicator.text) {
    const version = document.createElement('span')
    version.className = indicator.available
      ? 'legend-version legend-version--update'
      : 'legend-version'
    version.textContent = indicator.text
    legend.appendChild(version)
  }

  return legend
}

// Open/close the drawer. The drawer is always present in the DOM (built by the
// last full render, hidden via CSS); toggling it is a pure `.open` class flip —
// no DOM construction, no list rebuild — so pressing Select responds instantly
// and the panel slides up via the CSS transition rather than popping in late.
// Falls back to a full render if the drawer isn't in the DOM yet.
function setHelpOpen(open: boolean): void {
  if (open === helpOpen) return
  helpOpen = open

  const backdrop = document.querySelector<HTMLElement>('.help-backdrop')
  if (!backdrop) {
    render()
    return
  }

  backdrop.classList.toggle('open', helpOpen)
  // Refresh just the bottom chip (Settings <-> Close).
  document.querySelector('.legend')?.replaceWith(renderLegend())
}

// The settings/help drawer: a bottom-anchored panel (over a dim backdrop)
// listing every control one per row. Future optional settings get added to this
// same list. Clicking the backdrop closes it; clicking the panel doesn't.
function renderHelpDrawer(mode: 'menu' | 'channels'): HTMLElement {
  const backdrop = document.createElement('div')
  backdrop.className = 'help-backdrop'
  // Lives in the DOM full-time but stays hidden (and click-through) until open;
  // setHelpOpen flips this class, and CSS animates the slide/fade.
  if (helpOpen) backdrop.classList.add('open')
  backdrop.addEventListener('click', () => setHelpOpen(false))

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
    content.appendChild(renderHelpDrawer('menu'))
    app.appendChild(content)
    app.appendChild(renderLegend())
    domSelectionIndex = -1 // no channel list in the DOM
    return
  }

  const content = document.createElement('div')
  content.className = 'content'

  const list = document.createElement('div')
  list.className = 'channel-list'
  buildView(orderedState(), selectionIndex, collapsed).forEach((row, index) => {
    const el = renderRow(row)
    if (row.kind === 'header') {
      const guildId = row.guildId
      // The picked-up server gets a distinct "grabbed" look while reordering.
      if (reorderingGuildId === guildId) el.classList.add('grabbed')
      // Mouse drag-and-drop reordering (the pointer equivalent of long-press A).
      wireHeaderDrag(el, guildId)
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
  content.appendChild(renderHelpDrawer('channels'))
  app.appendChild(content)
  app.appendChild(renderVolumeBar())
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
  return buildView(orderedState(), selectionIndex, collapsed)[selectionIndex] ?? null
}

function handleAction(action: InputAction): void {
  // Reorder mode is modal: with a server "picked up", Up/Down move it, A/B/Y
  // drop it, zoom/window still work, and everything else is suppressed so the
  // grabbed server can't be lost mid-move. Checked first so even Select (help)
  // is ignored while holding a server.
  if (reorderingGuildId) {
    switch (action.type) {
      case 'nav':
        if (action.action === 'UP' || action.action === 'DOWN') {
          const displayed = orderGroups(state.groups, serverOrder).map((g) => g.guildId)
          serverOrder = moveGuild(displayed, reorderingGuildId, action.action)
          saveServerOrder()
          selectionIndex = headerRowIndex(reorderingGuildId) // selection follows it
          render()
        }
        return
      case 'pickup':
      case 'join':
      case 'disconnect':
        reorderingGuildId = null // drop it
        render()
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

  // Settings/help drawer takes priority: Select toggles it from anywhere, and
  // while it's open the only other input that does anything is B/Esc (close),
  // so it acts as a modal layer over the channel list.
  if (action.type === 'toggleHelp') {
    setHelpOpen(!helpOpen)
    return
  }
  if (helpOpen) {
    if (action.type === 'disconnect') setHelpOpen(false)
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
      const rows = buildView(orderedState(), selectionIndex, collapsed)
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
    case 'pickup': {
      // Long-press A on a server header picks it up for reordering; on a channel
      // a long press just falls back to joining it.
      const row = selectedRow()
      if (row?.kind === 'header') {
        reorderingGuildId = row.guildId
        render()
      } else if (row?.kind === 'channel') {
        void window.api.join(row.channelId)
      }
      break
    }
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
    case 'adjustVolume': {
      const current = action.target === 'input' ? state.inputVolume : state.outputVolume
      const next = stepVolume(current, action.direction, action.target)
      if (action.target === 'input') void window.api.setInputVolume(next)
      else void window.api.setOutputVolume(next)
      break
    }
  }
}

window.api.onUpdateStatus((next) => {
  updateStatus = next
  // Refresh just the corner; the legend is always in the DOM. Falls back to a
  // full render if it isn't (shouldn't happen, but cheap insurance).
  const legend = document.querySelector('.legend')
  if (legend) legend.replaceWith(renderLegend())
  else render()
})

window.api.onStateUpdate((next) => {
  state = next
  // Drop a held server if it vanished (e.g. the connection dropped) so the
  // reorder modal can't get stuck swallowing input.
  if (reorderingGuildId && !state.groups.some((g) => g.guildId === reorderingGuildId)) {
    reorderingGuildId = null
  }
  // Don't tear down the DOM mid drag — it would abort the slider's pointer
  // capture. The pending state is applied when the drag ends (see pointerup).
  if (volumeDragging) return
  render()
})

// Mouse drag ended anywhere: clear the guard and resync to the latest state
// (which may have advanced via our optimistic pushes while we suppressed render).
window.addEventListener('pointerup', () => {
  if (!volumeDragging) return
  volumeDragging = false
  render()
})

startGamepadLoop(handleAction)
startKeyboardFallback(handleAction)

// Re-render so the legend adopts the glyphs of whatever just (dis)connected.
window.addEventListener('gamepadconnected', render)
window.addEventListener('gamepaddisconnected', render)

applyScale()
render()
