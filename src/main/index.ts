import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { DiscordRpcClient } from './discord/rpc-client'
import { DiscordService } from './service'
import { AppStore } from './store'
import { IPC, type AppState } from '../shared/ipc'

const TOGGLE_VISIBILITY_SHORTCUT = 'CommandOrControl+Shift+`'

try {
  process.loadEnvFile(join(__dirname, '../../.env'))
} catch {
  // .env is optional outside development
}

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? ''

function toggleVisibility(window: BrowserWindow): void {
  if (window.isVisible()) {
    window.hide()
  } else {
    window.show()
  }
}

function createWindow(store: AppStore): BrowserWindow {
  const bounds = store.getWindowBounds()

  const mainWindow = new BrowserWindow({
    width: bounds?.width ?? 460,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
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

  return service
}

app.whenReady().then(() => {
  const store = new AppStore()
  const mainWindow = createWindow(store)
  startService(mainWindow, store)

  globalShortcut.register(TOGGLE_VISIBILITY_SHORTCUT, () => toggleVisibility(mainWindow))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(store)
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
