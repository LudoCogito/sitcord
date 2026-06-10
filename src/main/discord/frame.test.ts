import { describe, it, expect } from 'vitest'
import { encodeFrame, decodeFrames, OP } from './frame'

describe('encodeFrame', () => {
  it('writes op + little-endian length + json payload', () => {
    const buf = encodeFrame(OP.FRAME, { cmd: 'PING' })
    expect(buf.readInt32LE(0)).toBe(OP.FRAME)
    const len = buf.readInt32LE(4)
    expect(buf.length).toBe(8 + len)
    expect(JSON.parse(buf.subarray(8).toString('utf8'))).toEqual({ cmd: 'PING' })
  })
})

describe('decodeFrames', () => {
  it('decodes a single complete frame and leaves no remainder', () => {
    const buf = encodeFrame(OP.FRAME, { a: 1 })
    const { messages, rest } = decodeFrames(buf)
    expect(messages).toEqual([{ op: OP.FRAME, data: { a: 1 } }])
    expect(rest.length).toBe(0)
  })
  it('handles two concatenated frames', () => {
    const buf = Buffer.concat([encodeFrame(OP.FRAME, { a: 1 }), encodeFrame(OP.PING, { b: 2 })])
    const { messages } = decodeFrames(buf)
    expect(messages.length).toBe(2)
  })
  it('returns a partial frame as rest without emitting it', () => {
    const full = encodeFrame(OP.FRAME, { a: 1 })
    const { messages, rest } = decodeFrames(full.subarray(0, full.length - 3))
    expect(messages.length).toBe(0)
    expect(rest.length).toBe(full.length - 3)
  })
})
