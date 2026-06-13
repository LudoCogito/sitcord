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
import { join } from 'path'
import { DiscordRpcClient } from './discord/rpc-client'
import { DiscordService } from './service'
import { AppStore, type WindowBounds } from './store'
import { TRAY_ICON_DATA_URL } from './tray-icon'
import { IPC, type AppState } from '../shared/ipc'

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
// Module-scoped so the single-instance `second-instance` handler can summon it.
let mainWindow: BrowserWindow | null = null

function createTray(window: BrowserWindow): Tray {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  const t = new Tray(icon)
  t.setToolTip('Discord Big Picture')
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: () => toggleVisibility(window) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  // Left-click toggles on Windows/Linux; on macOS it opens the menu (which has
  // Show / Hide) — both give a reliable mouse path to summon a hidden window.
  t.on('click', () => toggleVisibility(window))
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

  const mainWindow = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep the gamepad-polling loop running at full rate when the window is
      // backgrounded/occluded (e.g. behind the Steam overlay).
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    store.setWindowBounds(mainWindow.getBounds())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function startService(mainWindow: BrowserWindow, store: AppStore): DiscordService {
  const rpc = new DiscordRpcClient({ clientId: CLIENT_ID })

  const service = new DiscordService({
    rpc,
    store,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    onStateUpdate: (state: AppState) => {
      mainWindow.webContents.send(IPC.STATE_UPDATE, state)
    }
  })

  service.start().catch((err) => {
    console.error('Failed to start Discord service:', err)
  })

  ipcMain.handle(IPC.VOICE_JOIN, (_event, channelId: string) => service.join(channelId))
  ipcMain.handle(IPC.VOICE_DISCONNECT, () => service.disconnect())
  ipcMain.handle(IPC.VOICE_SET_MUTE, (_event, muted: boolean) => service.setMute(muted))
  ipcMain.handle(IPC.VOICE_SET_DEAFEN, (_event, deafened: boolean) => service.setDeafen(deafened))
  ipcMain.handle(IPC.FAVORITE_TOGGLE, (_event, channelId: string) => service.toggleFavorite(channelId))
  ipcMain.handle(IPC.WINDOW_TOGGLE, () => toggleVisibility(mainWindow))
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => toggleMinimize(mainWindow))
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
    if (mainWindow) showWindow(mainWindow)
  })

  app.whenReady().then(() => {
    const store = new AppStore()
    const win = createWindow(store)
    mainWindow = win
    startService(win, store)
    tray = createTray(win)

    globalShortcut.register(TOGGLE_VISIBILITY_SHORTCUT, () => toggleVisibility(win))
    globalShortcut.register(TOGGLE_MINIMIZE_SHORTCUT, () => toggleMinimize(win))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(store)
    })
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
