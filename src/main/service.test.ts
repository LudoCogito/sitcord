import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiscordService, type RpcConnection, type ServiceStore } from './service'
import type { AppState } from '../shared/ipc'
import type { AuthData } from './store'
import type { Store as RankingStore, UsageEntry } from './ranking'

class FakeRpc extends EventEmitter implements RpcConnection {
  calls: { cmd: string; args: unknown }[] = []
  subscriptions: { evt: string; args: unknown }[] = []

  constructor(private responses: Record<string, any>) {
    super()
  }

  async connect(): Promise<void> {
    this.emit('event', { cmd: 'DISPATCH', evt: 'READY', data: {}, nonce: null })
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
  GET_CHANNEL: (args: { channel_id: string }) => ({
    data: { voice_states: args.channel_id === 'c1' ? [{ user: { id: 'u1' } }] : [] }
  }),
  SELECT_VOICE_CHANNEL: { data: {} }
}

function makeService(states: AppState[], store: MemoryStore): { service: DiscordService; rpc: FakeRpc } {
  const rpc = new FakeRpc(responses)
  const service = new DiscordService({
    rpc,
    store,
    clientId: 'cid',
    clientSecret: 'secret',
    onStateUpdate: (s) => states.push(s),
    now: () => 0
  })
  return { service, rpc }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DiscordService', () => {
  it('start() connects, authenticates, loads channels, and pushes ranked state', async () => {
    const states: AppState[] = []
    const store = new MemoryStore({ accessToken: 'tok', expiresAt: Infinity }, { favorites: ['c2'], usage: {} })
    const { service, rpc } = makeService(states, store)

    await service.start()

    expect(rpc.calls.map((c) => c.cmd)).toEqual([
      'AUTHENTICATE',
      'GET_GUILDS',
      'GET_CHANNELS',
      'GET_SELECTED_VOICE_CHANNEL',
      'GET_CHANNEL',
      'GET_CHANNEL'
    ])
    expect(rpc.subscriptions.map((s) => s.evt)).toEqual([
      'VOICE_CHANNEL_SELECT',
      'VOICE_STATE_CREATE',
      'VOICE_STATE_UPDATE',
      'VOICE_STATE_DELETE',
      'VOICE_STATE_CREATE',
      'VOICE_STATE_UPDATE',
      'VOICE_STATE_DELETE'
    ])

    expect(states).toHaveLength(1)
    const [state] = states
    expect(state.status).toBe('connected')
    expect(state.currentChannelId).toBeNull()
    expect(state.occupancy).toEqual({ c1: 1, c2: 0 })
    expect(state.groups).toEqual([
      {
        guildId: 'g1',
        guildName: 'Guild One',
        channels: [
          { id: 'c2', guildId: 'g1', guildName: 'Guild One', name: 'AFK' },
          { id: 'c1', guildId: 'g1', guildName: 'Guild One', name: 'General' }
        ]
      }
    ])
  })

  it('join() selects the channel, records usage, and pushes updated state', async () => {
    const states: AppState[] = []
    const store = new MemoryStore({ accessToken: 'tok', expiresAt: Infinity }, { favorites: [], usage: {} })
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
    const store = new MemoryStore({ accessToken: 'tok', expiresAt: Infinity }, { favorites: [], usage: {} })
    const { service } = makeService(states, store)
    await service.start()

    service.toggleFavorite('c1')

    expect(store.get().favorites).toEqual(['c1'])
    expect(states.at(-1)?.groups[0].channels[0].id).toBe('c1')
  })

  it('VOICE_CHANNEL_SELECT updates currentChannelId and refreshes occupancy after a debounce', async () => {
    const states: AppState[] = []
    const store = new MemoryStore({ accessToken: 'tok', expiresAt: Infinity }, { favorites: [], usage: {} })
    const { service, rpc } = makeService(states, store)
    await service.start()

    vi.useFakeTimers()
    rpc.emit('event', { cmd: 'DISPATCH', evt: 'VOICE_CHANNEL_SELECT', data: { channel_id: 'c1' }, nonce: null })

    expect(states).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(250)

    expect(states.at(-1)?.currentChannelId).toBe('c1')
  })
})
