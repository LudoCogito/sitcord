import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiscordService, type RpcConnection, type ServiceStore } from './service'
import type { AppState, ErrorReport } from '../shared/ipc'
import type { AuthData } from './store'
import type { Store as RankingStore, UsageEntry } from './ranking'

class FakeRpc extends EventEmitter implements RpcConnection {
  calls: { cmd: string; args: unknown }[] = []
  subscriptions: { evt: string; args: unknown }[] = []
  reconnectNowCalls = 0
  closeCalls = 0

  constructor(private responses: Record<string, any>) {
    super()
  }

  async connect(): Promise<void> {
    this.emit('event', { cmd: 'DISPATCH', evt: 'READY', data: {}, nonce: null })
  }

  reconnectNow(): void {
    this.reconnectNowCalls++
  }

  close(): void {
    this.closeCalls++
  }

  async request(cmd: string, args: unknown): Promise<any> {
    this.calls.push({ cmd, args })
    const res = this.responses[cmd]
    return typeof res === 'function' ? res(args) : res
  }

  async subscribe(evt: string, args?: unknown): Promise<any> {
    this.subscriptions.push({ evt, args })
    return {}
  }
}

class MemoryStore implements ServiceStore {
  constructor(
    private auth: AuthData | null,
    private data: RankingStore
  ) {}

  getAuth(): AuthData | null {
    return this.auth
  }

  setAuth(auth: AuthData | null): void {
    this.auth = auth
  }

  get(): RankingStore {
    return this.data
  }

  setFavorites(favorites: string[]): void {
    this.data = { ...this.data, favorites }
  }

  setUsage(usage: Record<string, UsageEntry>): void {
    this.data = { ...this.data, usage }
  }
}

const responses = {
  AUTHENTICATE: { data: { user: { username: 'me' } } },
  GET_GUILDS: { data: { guilds: [{ id: 'g1', name: 'Guild One' }] } },
  GET_GUILD: {
    data: { id: 'g1', name: 'Guild One', icon_url: 'https://cdn.discordapp.com/icons/g1/abc.png' }
  },
  GET_CHANNELS: {
    data: {
      channels: [
        { id: 'c1', name: 'General', type: 2 },
        { id: 'c2', name: 'AFK', type: 2 },
        { id: 't1', name: 'chat', type: 0 }
      ]
    }
  },
  GET_SELECTED_VOICE_CHANNEL: { data: null },
  GET_VOICE_SETTINGS: { data: { mute: false, deaf: false } },
  GET_CHANNEL: (args: { channel_id: string }) => ({
    data: { voice_states: args.channel_id === 'c1' ? [{ user: { id: 'u1' } }] : [] }
  }),
  SELECT_VOICE_CHANNEL: { data: {} }
}

function makeService(
  states: AppState[],
  store: MemoryStore,
  errors: ErrorReport[] = []
): { service: DiscordService; rpc: FakeRpc } {
  const rpc = new FakeRpc(responses)
  const service = new DiscordService({
    rpc,
    store,
    clientId: 'cid',
    clientSecret: 'secret',
    onStateUpdate: (s) => states.push(s),
    onError: (r) => errors.push(r),
    appContext: { version: 'test', platform: 'test' },
    now: () => 0
  })
  return { service, rpc }
}

afterEach(() => {
  vi.useRealTimers()
})

// Drain microtasks so the lazy guild-icon fetch (fire-and-forget after connect)
// settles. Uses a real macrotask, so call it before switching to fake timers.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('DiscordService', () => {
  it('start() connects, authenticates, loads channels, and pushes ranked state', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: ['c2'], usage: {} }
    )
    const { service, rpc } = makeService(states, store)

    await service.start()

    // GET_GUILD (icons) is fired lazily after the connected state, so it lands
    // last — not in the channel-loading critical path.
    expect(rpc.calls.map((c) => c.cmd)).toEqual([
      'AUTHENTICATE',
      'GET_GUILDS',
      'GET_CHANNELS',
      'GET_SELECTED_VOICE_CHANNEL',
      'GET_VOICE_SETTINGS',
      'GET_CHANNEL',
      'GET_CHANNEL',
      'GET_GUILD'
    ])
    expect(rpc.subscriptions.map((s) => s.evt)).toEqual([
      'VOICE_CHANNEL_SELECT',
      'VOICE_SETTINGS_UPDATE',
      'VOICE_STATE_CREATE',
      'VOICE_STATE_UPDATE',
      'VOICE_STATE_DELETE',
      'VOICE_STATE_CREATE',
      'VOICE_STATE_UPDATE',
      'VOICE_STATE_DELETE'
    ])

    // First paint: channels are listed immediately, before icons resolve.
    const first = states[0]
    expect(first.status).toBe('connected')
    expect(first.currentChannelId).toBeNull()
    expect(first.occupancy).toEqual({ c1: 1, c2: 0 })
    expect(first.groups[0].iconUrl).toBeUndefined()
    expect(first.groups[0].channels.map((c) => c.id)).toEqual(['c2', 'c1'])

    // Icons stream in lazily and get applied in a follow-up push.
    await flush()
    const icon = 'https://cdn.discordapp.com/icons/g1/abc.png'
    expect(states.at(-1)?.groups).toEqual([
      {
        guildId: 'g1',
        guildName: 'Guild One',
        iconUrl: icon,
        channels: [
          { id: 'c2', guildId: 'g1', guildName: 'Guild One', guildIconUrl: icon, name: 'AFK' },
          { id: 'c1', guildId: 'g1', guildName: 'Guild One', guildIconUrl: icon, name: 'General' }
        ]
      }
    ])
  })

  it('join() selects the channel, records usage, and pushes updated state', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()

    await service.join('c1')

    expect(rpc.calls.find((c) => c.cmd === 'SELECT_VOICE_CHANNEL')?.args).toEqual({
      channel_id: 'c1',
      force: true
    })
    expect(store.get().usage.c1).toEqual({ count: 1, lastJoined: 0 })
    expect(states.at(-1)?.currentChannelId).toBe('c1')
  })

  it('toggleFavorite() persists favorites and pushes updated state with new ranking', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service } = makeService(states, store)
    await service.start()

    service.toggleFavorite('c1')

    expect(store.get().favorites).toEqual(['c1'])
    expect(states.at(-1)?.groups[0].channels[0].id).toBe('c1')
  })

  it('re-authenticates and re-subscribes when a fresh READY arrives after a reconnect', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()

    expect(rpc.calls.filter((c) => c.cmd === 'AUTHENTICATE')).toHaveLength(1)
    const subsAfterStart = rpc.subscriptions.length

    rpc.emit('event', { cmd: 'DISPATCH', evt: 'READY', data: {}, nonce: null })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(rpc.calls.filter((c) => c.cmd === 'AUTHENTICATE')).toHaveLength(2)
    expect(rpc.subscriptions.length).toBe(subsAfterStart * 2)
    expect(states.at(-1)?.status).toBe('connected')
  })

  it("sets status to 'disconnected' and pushes state when the rpc connection drops", async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()
    expect(states.at(-1)?.status).toBe('connected')

    rpc.emit('disconnect')

    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('stop() closes the rpc connection', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()

    service.stop()

    expect(rpc.closeCalls).toBe(1)
  })

  it('retry() shows connecting and forces an immediate reconnect', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()

    service.retry()

    expect(states.at(-1)?.status).toBe('connecting')
    expect(rpc.reconnectNowCalls).toBe(1)
  })

  it('reads initial mute/deafen from Discord and applies VOICE_SETTINGS_UPDATE events', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      GET_VOICE_SETTINGS: { data: { mute: true, deaf: false } }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: () => {},
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })
    await service.start()

    expect(states.at(-1)?.muted).toBe(true)
    expect(states.at(-1)?.deafened).toBe(false)

    rpc.emit('event', {
      cmd: 'DISPATCH',
      evt: 'VOICE_SETTINGS_UPDATE',
      data: { mute: false, deaf: true },
      nonce: null
    })

    expect(states.at(-1)?.muted).toBe(false)
    expect(states.at(-1)?.deafened).toBe(true)
  })

  it('reads initial input/output volume from Discord and applies VOICE_SETTINGS_UPDATE volumes', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      GET_VOICE_SETTINGS: {
        data: { mute: false, deaf: false, input: { volume: 80 }, output: { volume: 150 } }
      }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: () => {},
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })
    await service.start()

    expect(states.at(-1)?.inputVolume).toBe(80)
    expect(states.at(-1)?.outputVolume).toBe(150)

    rpc.emit('event', {
      cmd: 'DISPATCH',
      evt: 'VOICE_SETTINGS_UPDATE',
      data: { input: { volume: 60 }, output: { volume: 200 } },
      nonce: null
    })

    expect(states.at(-1)?.inputVolume).toBe(60)
    expect(states.at(-1)?.outputVolume).toBe(200)
  })

  it('setInputVolume / setOutputVolume send a clamped SET_VOICE_SETTINGS and push state', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()

    await service.setInputVolume(72)
    await service.setOutputVolume(500) // above the 0–200 output range

    const inputCall = rpc.calls.filter((c) => c.cmd === 'SET_VOICE_SETTINGS').at(-2)
    const outputCall = rpc.calls.filter((c) => c.cmd === 'SET_VOICE_SETTINGS').at(-1)
    expect(inputCall?.args).toEqual({ input: { volume: 72 } })
    expect(outputCall?.args).toEqual({ output: { volume: 200 } })
    expect(states.at(-1)?.inputVolume).toBe(72)
    expect(states.at(-1)?.outputVolume).toBe(200)
  })

  it('emits a connection ErrorReport when setupSession fails after connect', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      AUTHENTICATE: () => {
        throw new Error('OAuth2 Error: invalid_scope')
      }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })

    await service.start()

    expect(errors).toHaveLength(1)
    expect(errors[0].category).toBe('connection')
    expect(errors[0].message).toContain('invalid_scope')
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('does NOT emit an ErrorReport when the initial socket connect fails', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc(responses)
    rpc.connect = async () => {
      throw new Error('ENOENT: discord not running')
    }
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })

    await service.start()

    expect(errors).toHaveLength(0)
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('does NOT emit an ErrorReport when a user-action RPC command rejects', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      SELECT_VOICE_CHANNEL: () => {
        throw new Error('rejected join')
      }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })
    await service.start()

    await service.join('c1').catch(() => {})

    expect(errors).toHaveLength(0)
  })

  it('VOICE_CHANNEL_SELECT updates currentChannelId and refreshes occupancy after a debounce', async () => {
    const states: AppState[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const { service, rpc } = makeService(states, store)
    await service.start()
    await flush() // let the lazy icon push settle first

    vi.useFakeTimers()
    const before = states.length
    rpc.emit('event', {
      cmd: 'DISPATCH',
      evt: 'VOICE_CHANNEL_SELECT',
      data: { channel_id: 'c1' },
      nonce: null
    })

    // The event itself doesn't push synchronously — occupancy is debounced.
    expect(states.length).toBe(before)

    await vi.advanceTimersByTimeAsync(250)

    expect(states.at(-1)?.currentChannelId).toBe('c1')
  })
})
