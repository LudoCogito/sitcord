import type { EventEmitter } from 'node:events'
import { AuthManager, type AuthStore, type RpcRequester } from './discord/auth'
import { rankChannels, type VoiceChannel, type Store as RankingStore, type UsageEntry } from './ranking'
import { recordJoin, toggleFavorite } from './store-logic'
import type { AppState, ConnectionStatus } from '../shared/ipc'

export interface RpcConnection extends EventEmitter, RpcRequester {
  connect(): Promise<void>
  subscribe(evt: string, args?: unknown): Promise<any>
  reconnectNow(): void
}

export interface ServiceStore extends AuthStore {
  get(): RankingStore
  setFavorites(favorites: string[]): void
  setUsage(usage: Record<string, UsageEntry>): void
}

export interface DiscordServiceOptions {
  rpc: RpcConnection
  store: ServiceStore
  clientId: string
  clientSecret: string
  onStateUpdate: (state: AppState) => void
  now?: () => number
}

const VOICE_CHANNEL_TYPES = new Set([2, 13])
const OCCUPANCY_DEBOUNCE_MS = 250

export class DiscordService {
  private readonly rpc: RpcConnection
  private readonly store: ServiceStore
  private readonly auth: AuthManager
  private readonly onStateUpdate: (state: AppState) => void
  private readonly now: () => number

  private channels: VoiceChannel[] = []
  private currentChannelId: string | null = null
  private occupancy: Record<string, number> = {}
  private status: ConnectionStatus = 'connecting'
  private muted = false
  private deafened = false
  private occupancyTimer: ReturnType<typeof setTimeout> | null = null
  private resolveFirstSetup: (() => void) | null = null

  constructor(options: DiscordServiceOptions) {
    this.rpc = options.rpc
    this.store = options.store
    this.now = options.now ?? Date.now
    this.onStateUpdate = options.onStateUpdate
    this.auth = new AuthManager({
      rpc: this.rpc,
      store: this.store,
      clientId: options.clientId,
      clientSecret: options.clientSecret
    })
    this.rpc.on('event', (data: any) => this.handleEvent(data))
    this.rpc.on('disconnect', () => this.onDisconnect())
  }

  async start(): Promise<void> {
    // Session setup is driven by the READY dispatch (see handleEvent ->
    // onReady), so it re-runs automatically whenever the rpc client
    // reconnects. start() resolves once the first setup attempt settles.
    const firstSetup = new Promise<void>((resolve) => {
      this.resolveFirstSetup = resolve
    })
    try {
      await this.rpc.connect()
    } catch {
      this.status = 'disconnected'
      this.pushState()
      return
    }
    await firstSetup
  }

  private async onReady(): Promise<void> {
    try {
      await this.setupSession()
    } catch {
      this.status = 'disconnected'
      this.pushState()
    } finally {
      this.resolveFirstSetup?.()
      this.resolveFirstSetup = null
    }
  }

  private async setupSession(): Promise<void> {
    await this.auth.authenticate(this.now())
    await this.loadChannels()
    await this.refreshCurrentChannel()
    await this.refreshVoiceSettings()
    await this.subscribeToVoiceEvents()
    await this.refreshOccupancy()
    this.status = 'connected'
    this.pushState()
  }

  private onDisconnect(): void {
    this.status = 'disconnected'
    this.pushState()
  }

  /** User-triggered "Retry": show connecting and force an immediate reconnect. */
  retry(): void {
    this.status = 'connecting'
    this.pushState()
    this.rpc.reconnectNow()
  }

  async join(channelId: string): Promise<void> {
    await this.rpc.request('SELECT_VOICE_CHANNEL', { channel_id: channelId, force: true })
    const next = recordJoin(this.store.get(), channelId, this.now())
    this.store.setUsage(next.usage)
    this.currentChannelId = channelId
    this.pushState()
  }

  async disconnect(): Promise<void> {
    await this.rpc.request('SELECT_VOICE_CHANNEL', { channel_id: null })
    this.currentChannelId = null
    this.pushState()
  }

  async setMute(muted: boolean): Promise<void> {
    await this.rpc.request('SET_VOICE_SETTINGS', { mute: muted })
    this.muted = muted
    this.pushState()
  }

  async setDeafen(deafened: boolean): Promise<void> {
    await this.rpc.request('SET_VOICE_SETTINGS', { deaf: deafened })
    this.deafened = deafened
    this.pushState()
  }

  toggleFavorite(channelId: string): void {
    const next = toggleFavorite(this.store.get(), channelId)
    this.store.setFavorites(next.favorites)
    this.pushState()
  }

  private async loadChannels(): Promise<void> {
    const guildsRes = await this.rpc.request('GET_GUILDS', {})
    const guilds: any[] = guildsRes.data?.guilds ?? []
    // Fan out per-guild channel fetches concurrently; isolate failures so one
    // guild we can't read doesn't wipe out the whole channel list.
    const perGuild = await Promise.all(
      guilds.map(async (guild) => {
        try {
          // GET_GUILDS only gives id+name, so fetch the guild for its icon_url
          // (a ready CDN url, or empty when the server has no icon). Tolerate
          // its failure — a missing icon shouldn't drop the channel list.
          const [channelsRes, guildRes] = await Promise.all([
            this.rpc.request('GET_CHANNELS', { guild_id: guild.id }),
            this.rpc.request('GET_GUILD', { guild_id: guild.id }).catch(() => null)
          ])
          const guildIconUrl: string | undefined = guildRes?.data?.icon_url || undefined
          const channels: any[] = channelsRes.data?.channels ?? []
          return channels
            .filter((channel) => VOICE_CHANNEL_TYPES.has(channel.type))
            .map((channel): VoiceChannel => ({
              id: channel.id,
              guildId: guild.id,
              guildName: guild.name,
              guildIconUrl,
              name: channel.name
            }))
        } catch {
          return [] as VoiceChannel[]
        }
      })
    )
    this.channels = perGuild.flat()
  }

  private async subscribeToVoiceEvents(): Promise<void> {
    await this.rpc.subscribe('VOICE_CHANNEL_SELECT')
    await this.rpc.subscribe('VOICE_SETTINGS_UPDATE')
    for (const channel of this.channels) {
      await this.rpc.subscribe('VOICE_STATE_CREATE', { channel_id: channel.id })
      await this.rpc.subscribe('VOICE_STATE_UPDATE', { channel_id: channel.id })
      await this.rpc.subscribe('VOICE_STATE_DELETE', { channel_id: channel.id })
    }
  }

  private async refreshCurrentChannel(): Promise<void> {
    const res = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL', {})
    this.currentChannelId = res.data?.id ?? null
  }

  private async refreshVoiceSettings(): Promise<void> {
    try {
      const res = await this.rpc.request('GET_VOICE_SETTINGS', {})
      this.muted = res?.data?.mute ?? false
      this.deafened = res?.data?.deaf ?? false
    } catch {
      // leave the last-known mute/deafen values in place
    }
  }

  private async refreshOccupancy(): Promise<void> {
    // Fan out the per-channel occupancy fetches concurrently; on a failure for
    // one channel keep its previous count rather than dropping the whole map.
    const entries = await Promise.all(
      this.channels.map(async (channel): Promise<[string, number]> => {
        try {
          const res = await this.rpc.request('GET_CHANNEL', { channel_id: channel.id })
          return [channel.id, res.data?.voice_states?.length ?? 0]
        } catch {
          return [channel.id, this.occupancy[channel.id] ?? 0]
        }
      })
    )
    this.occupancy = Object.fromEntries(entries)
  }

  private handleEvent(data: any): void {
    if (data?.evt === 'READY') {
      void this.onReady()
      return
    }
    if (data?.evt === 'VOICE_CHANNEL_SELECT') {
      this.currentChannelId = data.data?.channel_id ?? null
      this.scheduleOccupancyRefresh()
      return
    }
    if (data?.evt === 'VOICE_SETTINGS_UPDATE') {
      this.muted = data.data?.mute ?? this.muted
      this.deafened = data.data?.deaf ?? this.deafened
      this.pushState()
      return
    }
    if (
      data?.evt === 'VOICE_STATE_CREATE' ||
      data?.evt === 'VOICE_STATE_UPDATE' ||
      data?.evt === 'VOICE_STATE_DELETE'
    ) {
      this.scheduleOccupancyRefresh()
    }
  }

  private scheduleOccupancyRefresh(): void {
    if (this.occupancyTimer) clearTimeout(this.occupancyTimer)
    this.occupancyTimer = setTimeout(() => {
      this.occupancyTimer = null
      this.refreshOccupancy()
        .then(() => this.pushState())
        .catch(() => {})
    }, OCCUPANCY_DEBOUNCE_MS)
  }

  private pushState(): void {
    const store = this.store.get()
    this.onStateUpdate({
      status: this.status,
      groups: rankChannels(this.channels, store),
      currentChannelId: this.currentChannelId,
      occupancy: this.occupancy,
      favorites: store.favorites,
      muted: this.muted,
      deafened: this.deafened
    })
  }
}
