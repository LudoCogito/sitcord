// Generates a placeholder build/icon.png (no image deps) so the dock, window,
// and tray show *something* branded until real artwork replaces it. Run with:
//   node scripts/make-placeholder-icon.mjs
// A blurple rounded square with a white front-view loveseat silhouette (a nod
// to "Sit"-cord). Replace build/icon.png with your own 1024x1024 art whenever
// you have it.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 1024
const BG = [0x58, 0x65, 0xf2] // blurple
const FG = [0xff, 0xff, 0xff] // white
const corner = SIZE * 0.18 // rounded-corner radius of the badge

// White front-view loveseat silhouette ("Sit"-cord), drawn as the union of
// rounded parts: a wide backrest spanning the two tall arms, a single wide seat
// cushion in front of it, a seat rail joining the arms, and two outer legs. Thin
// blurple seams (between the cushion and each arm, and between the cushion and
// the backrest above) keep the cushion distinct from the frame. Each part is
// [x0,y0,x1,y1,rr] in fractions of SIZE (rr is its corner radius in px).
const FRAME_ROUND = SIZE * 0.05 // soft rounding for the arms, backrest and rail
const CUSHION_ROUND = SIZE * 0.025 // modest rounding for the single seat cushion
const LEG_ROUND = SIZE * 0.015 // small rounding for the stubby legs
const seatParts = [
  [0.275, 0.22, 0.725, 0.44, FRAME_ROUND], // backrest: tall, rises above the arms
  [0.29, 0.46, 0.71, 0.6, CUSHION_ROUND], // single wide seat cushion
  [0.15, 0.4, 0.275, 0.66, FRAME_ROUND], // left arm (shorter than the backrest)
  [0.725, 0.4, 0.85, 0.66, FRAME_ROUND], // right arm (shorter than the backrest)
  [0.15, 0.6, 0.85, 0.68, FRAME_ROUND], // seat rail joining the arms
  [0.19, 0.68, 0.29, 0.76, LEG_ROUND], // outer-left leg
  [0.71, 0.68, 0.81, 0.76, LEG_ROUND] // outer-right leg
].map(([x0, y0, x1, y1, rr]) => [x0 * SIZE, y0 * SIZE, x1 * SIZE, y1 * SIZE, rr])

function inRoundedRect(x, y) {
  const dx = Math.max(corner - x, x - (SIZE - corner), 0)
  const dy = Math.max(corner - y, y - (SIZE - corner), 0)
  return dx * dx + dy * dy <= corner * corner
}

// Signed-distance test for a rounded rect; true when (px,py) lies inside it.
function inRoundRect(px, py, x0, y0, x1, y1, rr) {
  const ccx = (x0 + x1) / 2
  const ccy = (y0 + y1) / 2
  const qx = Math.abs(px - ccx) - ((x1 - x0) / 2 - rr)
  const qy = Math.abs(py - ccy) - ((y1 - y0) / 2 - rr)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - rr <= 0
}

function inSeat(px, py) {
  for (const [x0, y0, x1, y1, rr] of seatParts) {
    if (inRoundRect(px, py, x0, y0, x1, y1, rr)) return true
  }
  return false
}

// Raw RGBA scanlines, each prefixed with a 0 filter byte.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4)
  raw[rowStart] = 0
  for (let x = 0; x < SIZE; x++) {
    const i = rowStart + 1 + x * 4
    const px = x + 0.5
    const py = y + 0.5
    const insideSquare = inRoundedRect(px, py)
    const insideSeat = inSeat(px, py)
    let r, g, b, a
    if (!insideSquare) {
      r = g = b = a = 0 // transparent outside the rounded square
    } else if (insideSeat) {
      ;[r, g, b] = FG
      a = 255
    } else {
      ;[r, g, b] = BG
      a = 255
    }
    raw[i] = r
    raw[i + 1] = g
    raw[i + 2] = b
    raw[i + 3] = a
  }
}

// --- minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type RGBA
// 10..12 compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'icon.png')
writeFileSync(outPath, png)
console.log(`wrote ${outPath} (${SIZE}x${SIZE}, ${png.length} bytes)`)
