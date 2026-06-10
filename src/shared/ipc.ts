import type { ServerGroup } from '../main/ranking'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface AppState {
  status: ConnectionStatus
  groups: ServerGroup[]
  currentChannelId: string | null
  occupancy: Record<string, number>
  favorites: string[]
  muted: boolean
  deafened: boolean
}

export const IPC = {
  STATE_UPDATE: 'state:update',
  VOICE_JOIN: 'voice:join',
  VOICE_DISCONNECT: 'voice:disconnect',
  VOICE_SET_MUTE: 'voice:setMute',
  VOICE_SET_DEAFEN: 'voice:setDeafen',
  FAVORITE_TOGGLE: 'favorite:toggle',
  WINDOW_TOGGLE: 'window:toggle'
} as const
