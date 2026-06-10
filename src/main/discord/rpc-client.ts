import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { encodeFrame, decodeFrames, OP } from './frame'
import { connectSocket } from './socket-path'

export interface Transport extends EventEmitter {
  write(data: Buffer): void
  end(): void
}

export type TransportFactory = () => Promise<Transport>

export interface RpcClientOptions {
  clientId: string
  transport?: TransportFactory
}

interface PendingRequest {
  resolve: (data: any) => void
  reject: (err: Error) => void
}

const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000

export class DiscordRpcClient extends EventEmitter {
  private readonly clientId: string
  private readonly createTransport: TransportFactory
  private transport: Transport | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private pending = new Map<string, PendingRequest>()
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  private stopped = false

  constructor(options: RpcClientOptions) {
    super()
    this.clientId = options.clientId
    this.createTransport = options.transport ?? connectSocket
  }

  async connect(): Promise<void> {
    this.stopped = false
    const transport = await this.createTransport()
    this.transport = transport
    this.buffer = Buffer.alloc(0)
    transport.on('data', (chunk: Buffer) => this.onData(chunk))
    transport.on('close', () => this.onClose())
    transport.on('error', () => {})
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS
    transport.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }))
  }

  close(): void {
    this.stopped = true
    this.transport?.end()
    this.transport = null
  }

  request(cmd: string, args: unknown): Promise<any> {
    return this.send({ cmd, args })
  }

  subscribe(evt: string, args?: unknown): Promise<any> {
    return this.send({ cmd: 'SUBSCRIBE', args, evt })
  }

  private send(payload: Record<string, unknown>): Promise<any> {
    if (!this.transport) return Promise.reject(new Error('Disconnected'))
    const nonce = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject })
      this.transport!.write(encodeFrame(OP.FRAME, { ...payload, nonce }))
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const { messages, rest } = decodeFrames(this.buffer)
    this.buffer = rest
    for (const { data } of messages) this.onMessage(data)
  }

  private onMessage(data: any): void {
    const nonce = data?.nonce
    if (nonce && this.pending.has(nonce)) {
      const { resolve, reject } = this.pending.get(nonce)!
      this.pending.delete(nonce)
      if (data.evt === 'ERROR') reject(new Error(data.data?.message ?? 'RPC error'))
      else resolve(data)
      return
    }
    if (data?.cmd === 'DISPATCH') {
      this.emit('event', data)
    }
  }

  private onClose(): void {
    this.transport = null
    for (const { reject } of this.pending.values()) reject(new Error('Disconnected'))
    this.pending.clear()

    if (this.stopped) return
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
    setTimeout(() => {
      this.connect().catch(() => this.onClose())
    }, delay)
  }
}
