import type { EventEmitter } from 'node:events'
import { AuthManager, type AuthStore, type RpcRequester } from './discord/auth'
import type { RpcResponse, RpcData } from './discord/types'
import {
  rankChannels,
  type VoiceChannel,
  type Store as RankingStore,
  type UsageEntry
} from './ranking'
import { recordJoin, toggleFavorite } from './store-logic'
import { clampVolume } from '../shared/volume'
import type { AppState, ConnectionStatus } from '../shared/ipc'

export interface RpcConnection extends EventEmitter, RpcRequester {
  connect(): Promise<void>
  subscribe(evt: string, args?: unknown): Promise<RpcResponse>
  reconnectNow(): void
  close(): void
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
  // Optional: omitted for a public (PKCE) client build.
  clientSecret?: string
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
  private guilds: { id: string; name: string }[] = []
  // guildId -> icon url (string) or null (fetched, no custom icon). Cached for
  // the app session so reconnects don't re-fetch or flash; a fresh launch
  // starts empty (the RPC gives no cache validator, and a server can change its
  // icon, so persisting urls would risk showing a stale one).
  private readonly guildIconCache = new Map<string, string | null>()
  private currentChannelId: string | null = null
  private occupancy: Record<string, number> = {}
  private status: ConnectionStatus = 'connecting'
  private statusDetail: string | undefined = undefined
  private muted = false
  private deafened = false
  // Discord defaults (input 0–100, output 0–200) until GET_VOICE_SETTINGS reads
  // the real values on connect.
  private inputVolume = 100
  private outputVolume = 100
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
    this.rpc.on('event', (data: RpcResponse) => this.handleEvent(data))
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
    } catch (err) {
      console.error('[sitcord] setupSession failed:', err)
      this.status = 'disconnected'
      this.statusDetail = err instanceof Error ? err.message : String(err)
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
    this.statusDetail = undefined
    this.pushState()
    // Icons stream in after first paint; never blocks the connected state.
    void this.loadGuildIcons().catch(() => {})
  }

  private onDisconnect(): void {
    this.status = 'disconnected'
    this.statusDetail = undefined
    this.pushState()
  }

  /** User-triggered "Retry": show connecting and force an immediate reconnect. */
  retry(): void {
    this.status = 'connecting'
    this.statusDetail = undefined
    this.pushState()
    this.rpc.reconnectNow()
  }

  /** Tear down on app quit: stop the debounce timer and close the RPC socket
   *  (which also clears its reconnect/request timers) so nothing fires during
   *  shutdown. */
  stop(): void {
    if (this.occupancyTimer) {
      clearTimeout(this.occupancyTimer)
      this.occupancyTimer = null
    }
    this.rpc.close()
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

  // Send a SET_VOICE_SETTINGS patch, then commit the matching local change and
  // push. Shared by the mute/deafen/volume mutators, which differ only in the
  // RPC payload and which field they update on success.
  private async sendVoiceSetting(patch: RpcData, commit: () => void): Promise<void> {
    await this.rpc.request('SET_VOICE_SETTINGS', patch)
    commit()
    this.pushState()
  }

  async setMute(muted: boolean): Promise<void> {
    await this.sendVoiceSetting({ mute: muted }, () => {
      this.muted = muted
    })
  }

  async setDeafen(deafened: boolean): Promise<void> {
    await this.sendVoiceSetting({ deaf: deafened }, () => {
      this.deafened = deafened
    })
  }

  async setInputVolume(volume: number): Promise<void> {
    const v = clampVolume(volume, 'input')
    await this.sendVoiceSetting({ input: { volume: v } }, () => {
      this.inputVolume = v
    })
  }

  async setOutputVolume(volume: number): Promise<void> {
    const v = clampVolume(volume, 'output')
    await this.sendVoiceSetting({ output: { volume: v } }, () => {
      this.outputVolume = v
    })
  }

  toggleFavorite(channelId: string): void {
    const next = toggleFavorite(this.store.get(), channelId)
    this.store.setFavorites(next.favorites)
    this.pushState()
  }

  private async loadChannels(): Promise<void> {
    const guildsRes = await this.rpc.request('GET_GUILDS', {})
    const guilds = guildsRes.data?.guilds ?? []
    this.guilds = guilds.map((guild) => ({ id: guild.id, name: guild.name }))
    // Fan out per-guild channel fetches concurrently; isolate failures so one
    // guild we can't read doesn't wipe out the whole channel list. Icons are
    // not fetched here — they come in lazily via loadGuildIcons() so a big
    // server count doesn't delay first paint. Any already-cached icon is
    // applied immediately (e.g. across a reconnect) to avoid a re-flash.
    const perGuild = await Promise.all(
      guilds.map(async (guild) => {
        try {
          const channelsRes = await this.rpc.request('GET_CHANNELS', { guild_id: guild.id })
          const channels = channelsRes.data?.channels ?? []
          return channels
            .filter((channel) => VOICE_CHANNEL_TYPES.has(channel.type))
            .map(
              (channel): VoiceChannel => ({
                id: channel.id,
                guildId: guild.id,
                guildName: guild.name,
                guildIconUrl: this.guildIconCache.get(guild.id) ?? undefined,
                name: channel.name
              })
            )
        } catch {
          return [] as VoiceChannel[]
        }
      })
    )
    this.channels = perGuild.flat()
  }

  // Lazily fetch each not-yet-cached guild's icon_url (GET_GUILD), then apply
  // and push once. Fire-and-forget after the connected state is up. GET_GUILDS
  // only returns id+name, so the icon needs this per-guild call; failures are
  // left uncached so a later reconnect can retry.
  private async loadGuildIcons(): Promise<void> {
    const pending = this.guilds.filter((guild) => !this.guildIconCache.has(guild.id))
    if (pending.length === 0) return

    await Promise.all(
      pending.map(async (guild) => {
        try {
          const res = await this.rpc.request('GET_GUILD', { guild_id: guild.id })
          this.guildIconCache.set(guild.id, res?.data?.icon_url || null)
        } catch {
          // Leave uncached; a future reconnect retries.
        }
      })
    )

    this.applyGuildIcons()
    this.pushState()
  }

  private applyGuildIcons(): void {
    this.channels = this.channels.map((channel) => ({
      ...channel,
      guildIconUrl: this.guildIconCache.get(channel.guildId) ?? undefined
    }))
  }

  private async subscribeToVoiceEvents(): Promise<void> {
    // Fire every SUBSCRIBE up front (in this order) and await them together,
    // rather than serially round-tripping each one — on someone with many
    // servers the serial version noticeably delayed the connected transition.
    // subscribe() writes synchronously, so issuing them in-order here preserves
    // ordering even though they resolve concurrently.
    const subscriptions: Promise<RpcResponse>[] = [
      this.rpc.subscribe('VOICE_CHANNEL_SELECT'),
      this.rpc.subscribe('VOICE_SETTINGS_UPDATE')
    ]
    for (const channel of this.channels) {
      subscriptions.push(
        this.rpc.subscribe('VOICE_STATE_CREATE', { channel_id: channel.id }),
        this.rpc.subscribe('VOICE_STATE_UPDATE', { channel_id: channel.id }),
        this.rpc.subscribe('VOICE_STATE_DELETE', { channel_id: channel.id })
      )
    }
    await Promise.all(subscriptions)
  }

  private async refreshCurrentChannel(): Promise<void> {
    const res = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL', {})
    this.currentChannelId = res.data?.id ?? null
  }

  // Merge a voice-settings payload (from GET_VOICE_SETTINGS or a
  // VOICE_SETTINGS_UPDATE dispatch) into local state. Missing fields keep their
  // current value; volumes are clamped to Discord's per-target range.
  private applyVoiceSettings(data: RpcData | undefined): void {
    this.muted = data?.mute ?? this.muted
    this.deafened = data?.deaf ?? this.deafened
    if (typeof data?.input?.volume === 'number') {
      this.inputVolume = clampVolume(data.input.volume, 'input')
    }
    if (typeof data?.output?.volume === 'number') {
      this.outputVolume = clampVolume(data.output.volume, 'output')
    }
  }

  private async refreshVoiceSettings(): Promise<void> {
    try {
      const res = await this.rpc.request('GET_VOICE_SETTINGS', {})
      this.applyVoiceSettings(res.data)
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

  private handleEvent(data: RpcResponse): void {
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
      this.applyVoiceSettings(data.data)
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
      statusDetail: this.statusDetail,
      groups: rankChannels(this.channels, store),
      currentChannelId: this.currentChannelId,
      occupancy: this.occupancy,
      favorites: store.favorites,
      muted: this.muted,
      deafened: this.deafened,
      inputVolume: this.inputVolume,
      outputVolume: this.outputVolume
    })
  }
}
