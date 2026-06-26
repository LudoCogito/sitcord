import type { ServerGroup } from './voice'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface AppState {
  status: ConnectionStatus
  // Human-readable reason for a 'disconnected' status, if known.
  statusDetail?: string
  groups: ServerGroup[]
  currentChannelId: string | null
  occupancy: Record<string, number>
  favorites: string[]
  muted: boolean
  deafened: boolean
  // Discord voice volumes: input (mic) 0–100, output (everyone else) 0–200.
  inputVolume: number
  outputVolume: number
}

// App self-update status, pushed independently of Discord state: the running
// version (for the bottom-right corner) and whether a newer release is ready.
export interface UpdateStatus {
  version: string
  updateAvailable: boolean
}

export const IPC = {
  STATE_UPDATE: 'state:update',
  UPDATE_STATUS: 'update:status',
  VOICE_JOIN: 'voice:join',
  VOICE_DISCONNECT: 'voice:disconnect',
  VOICE_SET_MUTE: 'voice:setMute',
  VOICE_SET_DEAFEN: 'voice:setDeafen',
  VOICE_SET_INPUT_VOLUME: 'voice:setInputVolume',
  VOICE_SET_OUTPUT_VOLUME: 'voice:setOutputVolume',
  FAVORITE_TOGGLE: 'favorite:toggle',
  WINDOW_TOGGLE: 'window:toggle',
  WINDOW_MINIMIZE: 'window:minimize',
  LAUNCH_DISCORD: 'discord:launch',
  RETRY_CONNECTION: 'discord:retry'
} as const
