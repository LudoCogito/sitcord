import type { EventEmitter } from 'node:events'
import { AuthManager, type AuthStore, type RpcRequester } from './discord/auth'
import { rankChannels, type VoiceChannel, type Store as RankingStore, type UsageEntry } from './ranking'
import { recordJoin, toggleFavorite } from './store-logic'
import type { AppState, ConnectionStatus } from '../shared/ipc'

export interface RpcConnection extends EventEmitter, RpcRequester {
  connect(): Promise<void>
  subscribe(evt: string, args?: unknown): Promise<any>
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
  }

  async start(): Promise<void> {
    await this.connectAndAuthenticate()
    await this.loadChannels()
    await this.subscribeToVoiceEvents()
    await this.refreshCurrentChannel()
    await this.refreshOccupancy()
    this.status = 'connected'
    this.pushState()
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

  private async connectAndAuthenticate(): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      const onEvent = (data: any): void => {
        if (data?.evt === 'READY') {
          this.rpc.off('event', onEvent)
          resolve()
        }
      }
      this.rpc.on('event', onEvent)
    })
    await this.rpc.connect()
    await ready
    await this.auth.authenticate(this.now())
  }

  private async loadChannels(): Promise<void> {
    const guildsRes = await this.rpc.request('GET_GUILDS', {})
    const channels: VoiceChannel[] = []
    for (const guild of guildsRes.data.guilds) {
      const channelsRes = await this.rpc.request('GET_CHANNELS', { guild_id: guild.id })
      for (const channel of channelsRes.data.channels) {
        if (VOICE_CHANNEL_TYPES.has(channel.type)) {
          channels.push({ id: channel.id, guildId: guild.id, guildName: guild.name, name: channel.name })
        }
      }
    }
    this.channels = channels
  }

  private async subscribeToVoiceEvents(): Promise<void> {
    await this.rpc.subscribe('VOICE_CHANNEL_SELECT')
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

  private async refreshOccupancy(): Promise<void> {
    const occupancy: Record<string, number> = {}
    for (const channel of this.channels) {
      const res = await this.rpc.request('GET_CHANNEL', { channel_id: channel.id })
      occupancy[channel.id] = res.data?.voice_states?.length ?? 0
    }
    this.occupancy = occupancy
  }

  private handleEvent(data: any): void {
    if (data?.evt === 'VOICE_CHANNEL_SELECT') {
      this.currentChannelId = data.data?.channel_id ?? null
      this.scheduleOccupancyRefresh()
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
    this.onStateUpdate({
      status: this.status,
      groups: rankChannels(this.channels, this.store.get()),
      currentChannelId: this.currentChannelId,
      occupancy: this.occupancy,
      muted: this.muted,
      deafened: this.deafened
    })
  }
}
