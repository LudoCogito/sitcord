// Task 0 spike: validate the Discord local RPC (IPC) flow end-to-end.
// Throwaway/exploratory script — not part of the test suite.
//
// Setup: fill in .env at the repo root with
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_TEST_CHANNEL_ID
// Run: node spike/rpc-spike.mjs

import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

process.loadEnvFile(new URL('../.env', import.meta.url))

const CLIENT_ID = process.env.DISCORD_CLIENT_ID
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET
const TEST_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID
const REDIRECT_URI = 'http://localhost'
const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write']

if (!CLIENT_ID || !CLIENT_SECRET || !TEST_CHANNEL_ID) {
  console.error('Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_TEST_CHANNEL_ID in .env')
  process.exit(1)
}

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 }

function encodeFrame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

function decodeFrames(buf) {
  const messages = []
  let offset = 0
  while (buf.length - offset >= 8) {
    const op = buf.readInt32LE(offset)
    const len = buf.readInt32LE(offset + 4)
    if (buf.length - offset - 8 < len) break
    const data = JSON.parse(buf.subarray(offset + 8, offset + 8 + len).toString('utf8'))
    messages.push({ op, data })
    offset += 8 + len
  }
  return { messages, rest: buf.subarray(offset) }
}

function candidatePaths() {
  if (os.platform() === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  }
  const dirs = [...new Set([process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, os.tmpdir(), '/tmp', '/var/run'].filter(Boolean))]
  const paths = []
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) {
      paths.push(path.join(dir, `discord-ipc-${i}`))
      paths.push(path.join(dir, 'snap.discord', `discord-ipc-${i}`))
      paths.push(path.join(dir, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`))
    }
  }
  return paths
}

function connect(candidate) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(candidate)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

async function findSocket() {
  for (const candidate of candidatePaths()) {
    if (os.platform() !== 'win32' && !fs.existsSync(candidate)) continue
    try {
      const socket = await connect(candidate)
      console.log(`Connected to ${candidate}`)
      return socket
    } catch {
      // try next candidate
    }
  }
  throw new Error('No Discord IPC socket found. Is Discord desktop running and logged in?')
}

class RpcClient {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.pending = new Map()
    this.onEvent = null
    socket.on('data', (chunk) => this.handleData(chunk))
    socket.on('error', (err) => console.error('Socket error:', err.message))
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const { messages, rest } = decodeFrames(this.buffer)
    this.buffer = rest
    for (const msg of messages) this.handleMessage(msg)
  }

  handleMessage({ data }) {
    console.log('<--', JSON.stringify(data))
    if (data.nonce && this.pending.has(data.nonce)) {
      const { resolve, reject } = this.pending.get(data.nonce)
      this.pending.delete(data.nonce)
      if (data.evt === 'ERROR') reject(new Error(JSON.stringify(data.data)))
      else resolve(data)
      return
    }
    if (this.onEvent) this.onEvent(data)
  }

  handshake() {
    this.socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }))
    return new Promise((resolve) => {
      this.onEvent = (data) => {
        if (data.evt === 'READY') {
          this.onEvent = null
          resolve(data)
        }
      }
    })
  }

  request(cmd, args) {
    const nonce = crypto.randomUUID()
    const payload = { cmd, args, nonce }
    console.log('-->', JSON.stringify(payload))
    this.socket.write(encodeFrame(OP.FRAME, payload))
    return new Promise((resolve, reject) => {
      this.pending.set(nonce, { resolve, reject })
    })
  }
}

async function exchangeToken(body) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  return res.json()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

async function tryPkce() {
  console.log('\n--- Step 3: PKCE check (fresh connection, no AUTHENTICATE) ---')
  console.log('A second AUTHORIZE prompt will appear in Discord — approve it.')
  const socket = await findSocket()
  const rpc = new RpcClient(socket)
  await rpc.handshake()
  const { verifier, challenge } = pkcePair()
  try {
    const authRes = await rpc.request('AUTHORIZE', {
      client_id: CLIENT_ID,
      scopes: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const code = authRes.data.code
    console.log('AUTHORIZE with code_challenge succeeded, got code')

    const tokenJson = await exchangeToken({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    })
    if (tokenJson.access_token) {
      console.log('PKCE RESULT: token exchange succeeded WITHOUT client_secret — RPC AUTHORIZE supports PKCE')
    } else {
      console.log('PKCE RESULT: token exchange failed without client_secret:', JSON.stringify(tokenJson))
    }
  } catch (err) {
    console.log('PKCE RESULT: AUTHORIZE with code_challenge failed:', err.message)
  } finally {
    socket.end()
  }
}

async function main() {
  const socket = await findSocket()
  const rpc = new RpcClient(socket)

  await rpc.handshake()
  console.log('Handshake OK, READY received')

  console.log('\n--- Step 4: AUTHORIZE — approve the prompt in Discord ---')
  const authorizeRes = await rpc.request('AUTHORIZE', { client_id: CLIENT_ID, scopes: SCOPES })
  const code = authorizeRes.data.code
  console.log('Got authorization code')

  console.log('\n--- Step 5: token exchange ---')
  const tokenJson = await exchangeToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  })
  if (!tokenJson.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokenJson)}`)
  console.log('Token exchange OK')

  console.log('\n--- Step 6: AUTHENTICATE ---')
  const authRes = await rpc.request('AUTHENTICATE', { access_token: tokenJson.access_token })
  console.log(`Authenticated as ${authRes.data.user.username}`)

  console.log('\n--- Step 7: GET_GUILDS / GET_CHANNELS ---')
  const guildsRes = await rpc.request('GET_GUILDS', {})
  const guilds = guildsRes.data.guilds
  console.log(`Found ${guilds.length} guild(s)`)
  if (guilds.length === 0) throw new Error('No guilds found')

  const firstGuild = guilds[0]
  const channelsRes = await rpc.request('GET_CHANNELS', { guild_id: firstGuild.id })
  const voiceChannels = channelsRes.data.channels.filter((c) => c.type === 2 || c.type === 13)
  console.log(`Voice/stage channels in "${firstGuild.name}":`)
  for (const ch of voiceChannels) console.log(`  [type ${ch.type}] ${ch.id} — ${ch.name}`)

  console.log('\n--- Step 8: SELECT_VOICE_CHANNEL / SET_VOICE_SETTINGS ---')
  console.log(`Joining channel ${TEST_CHANNEL_ID}...`)
  await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: TEST_CHANNEL_ID, force: true })
  console.log('Joined — check Discord, your account should now be in the voice channel.')

  await sleep(3000)

  console.log('Muting...')
  await rpc.request('SET_VOICE_SETTINGS', { mute: true })
  console.log('Muted — check Discord.')

  await sleep(3000)

  console.log('Unmuting...')
  await rpc.request('SET_VOICE_SETTINGS', { mute: false })

  await sleep(1000)

  console.log('Disconnecting...')
  await rpc.request('SELECT_VOICE_CHANNEL', { channel_id: null })
  console.log('Disconnected.')

  socket.end()

  await tryPkce()

  process.exit(0)
}

main().catch((err) => {
  console.error('\nSpike failed:', err.message)
  process.exit(1)
})
