// Cross-process voice data shapes shared by the main process (ranking, store)
// and the renderer (via the IPC `AppState` contract in ipc.ts). They live here
// in `shared` so the renderer's type graph never has to reach into `main` —
// `shared` is the leaf that both sides depend on.

export interface VoiceChannel {
  id: string
  guildId: string
  guildName: string
  guildIconUrl?: string
  name: string
}

export interface UsageEntry {
  count: number
  lastJoined: number
}

export interface Store {
  favorites: string[]
  usage: Record<string, UsageEntry>
}

export interface ServerGroup {
  guildId: string
  guildName: string
  iconUrl?: string
  channels: VoiceChannel[]
}
