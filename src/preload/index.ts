import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppState } from '../shared/ipc'

const api = {
  onStateUpdate(callback: (state: AppState) => void): void {
    ipcRenderer.on(IPC.STATE_UPDATE, (_event, state: AppState) => callback(state))
  },
  join(channelId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_JOIN, channelId)
  },
  disconnect(): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_DISCONNECT)
  },
  setMute(muted: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_SET_MUTE, muted)
  },
  setDeafen(deafened: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_SET_DEAFEN, deafened)
  },
  toggleFavorite(channelId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.FAVORITE_TOGGLE, channelId)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
