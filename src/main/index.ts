import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray
} from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'path'
import { DiscordRpcClient } from './discord/rpc-client'
import { DiscordService } from './service'
import { AppStore, type WindowBounds } from './store'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import { initUpdater } from './updater'
import { IPC, type AppState, type UpdateStatus } from '../shared/ipc'

const TOGGLE_VISIBILITY_SHORTCUT = 'CommandOrControl+Shift+`'
// Minimize/restore. Bind a controller combo to this in Steam Input for a
// controller-only minimize (don't use the Guide button alone — Steam and other
// overlays reserve it).
const TOGGLE_MINIMIZE_SHORTCUT = 'CommandOrControl+Shift+M'

try {
  process.loadEnvFile(join(__dirname, '../../.env'))
} catch {
  // .env is optional outside development
}

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? ''

// Your app icon. Drop a square PNG (1024×1024 ideal) at build/icon.png:
//  - electron-builder uses build/ as its resources dir, so the *packaged*
//    app/installer icon is generated from it automatically (it can also take
//    build/icon.icns and build/icon.ico if you want hand-tuned platform icons).
//  - In dev we load that same file below for the dock (macOS) and window/
//    taskbar (Windows/Linux) so you're not staring at the Electron logo.
// build/ isn't copied into the packaged bundle, but the packaged app already
// has the icon baked in by electron-builder, so the missing-path no-op is fine.
function appIconPath(): string | null {
  const path = join(__dirname, '../../build/icon.png')
  return existsSync(path) ? path : null
}

function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function toggleVisibility(window: BrowserWindow): void {
  // A minimized window still reports isVisible() true, so treat it as "bring it
  // back" rather than hide.
  if (window.isVisible() && !window.isMinimized()) {
    window.hide()
  } else {
    showWindow(window)
  }
}

// Minimize when up, restore when parked. The in-app LB+RB chord can only reach
// the "minimize" half (a minimized window stops polling the gamepad); the
// global hotkey and tray cover restore.
function toggleMinimize(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore()
    window.focus()
  } else {
    window.minimize()
  }
}

// Best-effort launch of the Discord desktop client. The RPC reconnect loop
// then connects to it automatically once its IPC socket is up.
function launchDiscord(): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Discord'], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA
      if (local) {
        spawn(join(local, 'Discord', 'Update.exe'), ['--processStart', 'Discord.exe'], {
          detached: true,
          stdio: 'ignore'
        }).unref()
      } else {
        void shell.openExternal('discord://')
      }
    } else {
      // Linux: try a Discord on PATH; fall back to the URL scheme handler.
      const child = spawn('discord', [], { detached: true, stdio: 'ignore' })
      child.on('error', () => void shell.openExternal('discord://'))
      child.unref()
    }
  } catch {
    void shell.openExternal('discord://')
  }
}

// Held so it isn't garbage-collected (which would remove the icon).
let tray: Tray | null = null
// Module-scoped so handlers, the tray, global shortcuts and the single-instance
// handler all target the *current* window. On macOS closing the window destroys
// it without quitting the app, so the window can come and go — never capture a
// specific instance in a long-lived closure.
let mainWindow: BrowserWindow | null = null
let appStore: AppStore | null = null
// Last state the service pushed, replayed to a freshly (re)opened window so it
// reflects the live connection instead of being stuck on "connecting".
let lastState: AppState | null = null
// Likewise for the update/version status, so a reopened window shows the corner
// version (and any "Update available") without waiting for the next check.
let lastUpdateStatus: UpdateStatus | null = null

// Single funnel for state pushes. Guards against a destroyed window (the bug
// behind "Object has been destroyed" on retry after a close/reopen).
function sendState(state: AppState): void {
  lastState = state
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.STATE_UPDATE, state)
  }
}

// Same destroyed-window guard + caching for the update/version corner.
function sendUpdateStatus(status: UpdateStatus): void {
  lastUpdateStatus = status
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPDATE_STATUS, status)
  }
}

// The live window, recreating it if it was closed/destroyed. Everything that
// needs to act on "the window" goes through here so it survives a reopen.
function ensureWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  if (!appStore) appStore = new AppStore()
  mainWindow = createWindow(appStore)
  return mainWindow
}

function createTray(): Tray {
  // Match the app icon (build/icon.png), shrunk to tray size. Falls back to the
  // embedded placeholder PNG when no icon.png has been dropped in yet.
  const iconPath = appIconPath()
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  const t = new Tray(icon)
  t.setToolTip('Sitcord')
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: () => toggleVisibility(ensureWindow()) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  // Left-click toggles on Windows/Linux; on macOS it opens the menu (which has
  // Show / Hide) — both give a reliable mouse path to summon a hidden window.
  t.on('click', () => toggleVisibility(ensureWindow()))
  return t
}

const DEFAULT_WIDTH = 460
const DEFAULT_HEIGHT = 760
// Gap from the screen edge for the first-launch position.
const EDGE_MARGIN = 16

// First-launch home: tucked into the top-right corner of the primary display's
// work area (which excludes the taskbar/dock). After the user drags it, the
// saved bounds take over and this is no longer used.
function topRightPosition(width: number, height: number): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - width - EDGE_MARGIN,
    y: workArea.y + EDGE_MARGIN
  }
}

// Saved bounds from a since-changed monitor layout could land the window
// entirely off any display; treat those as invalid and fall back to top-right.
function isOnScreen(b: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
}

function createWindow(store: AppStore): BrowserWindow {
  const bounds = store.getWindowBounds()
  const width = bounds?.width ?? DEFAULT_WIDTH
  const height = bounds?.height ?? DEFAULT_HEIGHT
  const position =
    bounds && isOnScreen(bounds) ? { x: bounds.x, y: bounds.y } : topRightPosition(width, height)

  const iconPath = appIconPath()

  const win = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    // Window/taskbar icon on Windows/Linux (macOS uses the dock icon set below).
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep the gamepad-polling loop running at full rate when the window is
      // backgrounded/occluded (e.g. behind the Steam overlay).
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', () => {
    store.setWindowBounds(win.getBounds())
  })

  // Replay the latest service state to this window once its renderer loads, so a
  // reopened window picks up the live connection instead of showing "connecting".
  win.webContents.on('did-finish-load', () => {
    if (lastState) win.webContents.send(IPC.STATE_UPDATE, lastState)
    if (lastUpdateStatus) win.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function startService(store: AppStore): DiscordService {
  const rpc = new DiscordRpcClient({ clientId: CLIENT_ID })

  const service = new DiscordService({
    rpc,
    store,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    // Funnel through sendState so a closed/destroyed window is skipped rather
    // than throwing, and the state is cached for the next window that opens.
    onStateUpdate: sendState
  })

  service.start().catch((err) => {
    console.error('Failed to start Discord service:', err)
  })

  ipcMain.handle(IPC.VOICE_JOIN, (_event, channelId: string) => service.join(channelId))
  ipcMain.handle(IPC.VOICE_DISCONNECT, () => service.disconnect())
  ipcMain.handle(IPC.VOICE_SET_MUTE, (_event, muted: boolean) => service.setMute(muted))
  ipcMain.handle(IPC.VOICE_SET_DEAFEN, (_event, deafened: boolean) => service.setDeafen(deafened))
  ipcMain.handle(IPC.FAVORITE_TOGGLE, (_event, channelId: string) => service.toggleFavorite(channelId))
  ipcMain.handle(IPC.WINDOW_TOGGLE, () => toggleVisibility(ensureWindow()))
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => toggleMinimize(ensureWindow()))
  ipcMain.handle(IPC.LAUNCH_DISCORD, () => launchDiscord())
  ipcMain.handle(IPC.RETRY_CONNECTION, () => service.retry())

  return service
}

// Only one copy may run. If a second launch happens — e.g. selecting the
// pinned entry again from Steam Big Picture while it's already in the tray —
// the running instance catches `second-instance` and summons itself instead of
// opening a duplicate (the duplicate quits immediately). This is what lets
// "navigate to it in Big Picture" act as a focus.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow(ensureWindow())
  })

  app.whenReady().then(() => {
    // Replace the Electron logo in the macOS dock during development. (The
    // packaged .app gets its icon from electron-builder, so this is a dev nicety.)
    if (process.platform === 'darwin') {
      const iconPath = appIconPath()
      if (iconPath) app.dock?.setIcon(iconPath)
    }

    appStore = new AppStore()
    mainWindow = createWindow(appStore)
    startService(appStore)
    tray = createTray()

    // Drive the bottom-right version/update corner. No-ops past the version
    // baseline in dev or without a configured publish provider.
    initUpdater(sendUpdateStatus)

    globalShortcut.register(TOGGLE_VISIBILITY_SHORTCUT, () => toggleVisibility(ensureWindow()))
    globalShortcut.register(TOGGLE_MINIMIZE_SHORTCUT, () => toggleMinimize(ensureWindow()))

    // Dock-icon click on macOS after the window was closed: bring it back.
    app.on('activate', () => showWindow(ensureWindow()))
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
