import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodeFrame, decodeFrames, OP } from './frame'
import { DiscordRpcClient } from './rpc-client'

class FakeTransport extends EventEmitter {
  written: Buffer[] = []
  ended = false

  write(data: Buffer): void {
    this.written.push(data)
  }

  end(): void {
    this.ended = true
  }
}

function decodeOne(buf: Buffer): any {
  return decodeFrames(buf).messages[0].data
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DiscordRpcClient', () => {
  it('sends a HANDSHAKE frame with v and client_id on connect', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })

    await client.connect()

    expect(transport.written).toHaveLength(1)
    const { op, data } = decodeFrames(transport.written[0]).messages[0]
    expect(op).toBe(OP.HANDSHAKE)
    expect(data).toEqual({ v: 1, client_id: 'abc123' })
  })

  it('resolves request() when a message with the matching nonce arrives', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const reqPromise = client.request('GET_GUILDS', {})
    const sent = decodeOne(transport.written[1])
    expect(sent.cmd).toBe('GET_GUILDS')
    expect(typeof sent.nonce).toBe('string')

    transport.emit(
      'data',
      encodeFrame(OP.FRAME, {
        cmd: 'GET_GUILDS',
        evt: null,
        data: { guilds: [] },
        nonce: sent.nonce
      })
    )

    await expect(reqPromise).resolves.toEqual({
      cmd: 'GET_GUILDS',
      evt: null,
      data: { guilds: [] },
      nonce: sent.nonce
    })
  })

  it('rejects request() when the response has evt: ERROR', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const reqPromise = client.request('SELECT_VOICE_CHANNEL', { channel_id: '1' })
    const sent = decodeOne(transport.written[1])

    transport.emit(
      'data',
      encodeFrame(OP.FRAME, {
        cmd: 'SELECT_VOICE_CHANNEL',
        evt: 'ERROR',
        data: { code: 4006, message: 'Invalid channel' },
        nonce: sent.nonce
      })
    )

    await expect(reqPromise).rejects.toThrow('Invalid channel')
  })

  it('emits "event" for DISPATCH messages with no matching pending request', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const events: any[] = []
    client.on('event', (e) => events.push(e))

    transport.emit(
      'data',
      encodeFrame(OP.FRAME, {
        cmd: 'DISPATCH',
        evt: 'VOICE_STATE_CREATE',
        data: { foo: 1 },
        nonce: null
      })
    )

    expect(events).toEqual([
      { cmd: 'DISPATCH', evt: 'VOICE_STATE_CREATE', data: { foo: 1 }, nonce: null }
    ])
  })

  it('decodes a frame split across two data events', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const events: any[] = []
    client.on('event', (e) => events.push(e))

    const full = encodeFrame(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {}, nonce: null })
    transport.emit('data', full.subarray(0, 5))
    transport.emit('data', full.subarray(5))

    expect(events).toEqual([{ cmd: 'DISPATCH', evt: 'READY', data: {}, nonce: null }])
  })

  it('subscribe() sends a SUBSCRIBE frame with the event name and args', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    void client.subscribe('VOICE_STATE_CREATE', { channel_id: '42' })

    const sent = decodeOne(transport.written[1])
    expect(sent.cmd).toBe('SUBSCRIBE')
    expect(sent.evt).toBe('VOICE_STATE_CREATE')
    expect(sent.args).toEqual({ channel_id: '42' })
    expect(typeof sent.nonce).toBe('string')
  })

  it('reconnects with backoff after the transport closes', async () => {
    vi.useFakeTimers()

    const transports: FakeTransport[] = []
    const factory = async (): Promise<FakeTransport> => {
      const t = new FakeTransport()
      transports.push(t)
      return t
    }

    const client = new DiscordRpcClient({ clientId: 'abc123', transport: factory })
    await client.connect()
    expect(transports).toHaveLength(1)

    transports[0].emit('close')
    await vi.advanceTimersByTimeAsync(1000)

    expect(transports).toHaveLength(2)
  })

  it('emits "disconnect" when an established transport closes unexpectedly', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const disconnects: number[] = []
    client.on('disconnect', () => disconnects.push(1))

    transport.emit('close')

    expect(disconnects).toHaveLength(1)
  })

  it('does not emit "disconnect" when close() was called intentionally', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const disconnects: number[] = []
    client.on('disconnect', () => disconnects.push(1))

    client.close()
    transport.emit('close')

    expect(disconnects).toHaveLength(0)
  })

  it('rejects pending requests when the transport closes', async () => {
    const transport = new FakeTransport()
    const client = new DiscordRpcClient({ clientId: 'abc123', transport: async () => transport })
    await client.connect()

    const reqPromise = client.request('GET_GUILDS', {})
    transport.emit('close')

    await expect(reqPromise).rejects.toThrow('Disconnected')
  })

  it('retries in the background when the initial connect fails (Discord not running yet)', async () => {
    vi.useFakeTimers()

    let attempt = 0
    const transports: FakeTransport[] = []
    const factory = async (): Promise<FakeTransport> => {
      attempt++
      if (attempt === 1) throw new Error('No Discord IPC socket found')
      const t = new FakeTransport()
      transports.push(t)
      return t
    }

    const client = new DiscordRpcClient({ clientId: 'abc123', transport: factory })

    await expect(client.connect()).rejects.toThrow('No Discord IPC socket found')
    expect(transports).toHaveLength(0)

    // Discord launches; the backoff timer fires and the next attempt succeeds.
    await vi.advanceTimersByTimeAsync(1000)
    expect(transports).toHaveLength(1)
  })

  it('emits "disconnect" when the initial connect fails', async () => {
    vi.useFakeTimers()
    const client = new DiscordRpcClient({
      clientId: 'abc123',
      transport: async () => {
        throw new Error('No Discord IPC socket found')
      }
    })

    const disconnects: number[] = []
    client.on('disconnect', () => disconnects.push(1))

    await expect(client.connect()).rejects.toThrow()
    expect(disconnects).toHaveLength(1)
  })

  it('reconnectNow() retries immediately without waiting for the backoff', async () => {
    vi.useFakeTimers()

    let attempt = 0
    const transports: FakeTransport[] = []
    const factory = async (): Promise<FakeTransport> => {
      attempt++
      if (attempt === 1) throw new Error('No Discord IPC socket found')
      const t = new FakeTransport()
      transports.push(t)
      return t
    }

    const client = new DiscordRpcClient({ clientId: 'abc123', transport: factory })
    await expect(client.connect()).rejects.toThrow()

    client.reconnectNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(transports).toHaveLength(1)
  })

  it('reconnectNow() is a no-op while already connected', async () => {
    const transport = new FakeTransport()
    let created = 0
    const client = new DiscordRpcClient({
      clientId: 'abc123',
      transport: async () => {
        created++
        return transport
      }
    })
    await client.connect()
    expect(created).toBe(1)

    client.reconnectNow()
    expect(created).toBe(1)
  })
})
