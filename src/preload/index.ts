import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppState, type UpdateStatus } from '../shared/ipc'

const api = {
  onStateUpdate(callback: (state: AppState) => void): void {
    ipcRenderer.on(IPC.STATE_UPDATE, (_event, state: AppState) => callback(state))
  },
  onUpdateStatus(callback: (status: UpdateStatus) => void): void {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_event, status: UpdateStatus) => callback(status))
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
  setInputVolume(volume: number): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_SET_INPUT_VOLUME, volume)
  },
  setOutputVolume(volume: number): Promise<void> {
    return ipcRenderer.invoke(IPC.VOICE_SET_OUTPUT_VOLUME, volume)
  },
  toggleFavorite(channelId: string): Promise<void> {
    return ipcRenderer.invoke(IPC.FAVORITE_TOGGLE, channelId)
  },
  toggleVisibility(): Promise<void> {
    return ipcRenderer.invoke(IPC.WINDOW_TOGGLE)
  },
  minimize(): Promise<void> {
    return ipcRenderer.invoke(IPC.WINDOW_MINIMIZE)
  },
  launchDiscord(): Promise<void> {
    return ipcRenderer.invoke(IPC.LAUNCH_DISCORD)
  },
  retryConnection(): Promise<void> {
    return ipcRenderer.invoke(IPC.RETRY_CONNECTION)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
