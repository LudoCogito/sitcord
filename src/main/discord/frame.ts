export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

export interface DecodedMessage {
  op: number
  data: any
}

export function decodeFrames(buf: Buffer): { messages: DecodedMessage[]; rest: Buffer } {
  const messages: DecodedMessage[] = []
  let offset = 0
  while (buf.length - offset >= 8) {
    const op = buf.readInt32LE(offset)
    const len = buf.readInt32LE(offset + 4)
    if (buf.length - offset - 8 < len) break
    const payload = buf.subarray(offset + 8, offset + 8 + len).toString('utf8')
    offset += 8 + len
    // A complete frame whose payload isn't valid JSON is unrecoverable on its
    // own, but its length is known — skip just that frame and keep decoding.
    try {
      messages.push({ op, data: JSON.parse(payload) })
    } catch {
      // drop the corrupt frame
    }
  }
  return { messages, rest: buf.subarray(offset) }
}
