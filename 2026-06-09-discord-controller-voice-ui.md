# Discord Controller Voice UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A cross-platform, controller-first Electron mini UI that lists and controls Discord voice channels (join/switch/disconnect/mute/deafen, with live occupancy) without opening the main Discord window — launchable as a Non-Steam Game.

**Architecture:** Two-process Electron app. The **main process** owns a `DiscordRpcClient` (talks to the local Discord IPC socket), an `AuthManager` (OAuth2 RPC handshake), and a `Store` (favorites + usage). The **renderer** reads the Gamepad API, renders a server-grouped voice-channel list (favorites pinned, then usage-ranked), and sends intents to main over a `contextBridge` preload bridge.

**Tech Stack:** Electron, TypeScript, electron-vite (build), Vitest (unit tests), electron-store (persistence), electron-builder (packaging). Renderer is plain TS + HTML/CSS (no UI framework in v1).

**Design doc:** `docs/plans/2026-06-09-discord-controller-voice-ui-design.md`

---

## Task 0: Spike — validate Discord RPC end-to-end (de-risk)

**Purpose:** Before building anything, prove the risky assumptions: that we can connect to the local Discord IPC socket, authorize, list voice channels, and actually move our own account with `SELECT_VOICE_CHANNEL` / toggle `SET_VOICE_SETTINGS`. This is exploratory, not TDD. Output is throwaway but its findings gate the rest.

**Prerequisites (manual, you do these):**
- Discord desktop client installed and running, logged in, member of at least one server with a voice channel.
- Create an application at <https://discord.com/developers/applications>. Note the **Client ID** and **Client Secret**. Under OAuth2, add redirect `http://localhost` (RPC uses it nominally). You are the owner, so RPC scopes work for you without approval.

**Files:**
- Create: `spike/rpc-spike.mjs`

**Step 1:** Write a standalone Node script (`spike/rpc-spike.mjs`) that:
1. Detects the IPC socket path. Windows: `\\?\pipe\discord-ipc-0` (try `-0` .. `-9`). macOS/Linux: look in `process.env.XDG_RUNTIME_DIR`, `TMPDIR`, `/tmp`, `/var/run` for `discord-ipc-0`.
2. Connects via `net.createConnection`.
3. Sends an IPC **handshake** frame: opcode `0` (handshake), JSON `{ v: 1, client_id: "<CLIENT_ID>" }`. Frame format: little-endian `Int32` opcode, `Int32` payload byte length, then UTF-8 JSON.
4. On the `DISPATCH`/`READY` response, sends `AUTHORIZE` (opcode `1` FRAME) with `{ cmd: "AUTHORIZE", args: { client_id, scopes: ["rpc","rpc.voice.read","rpc.voice.write"] }, nonce: "<uuid>" }`. Approve the prompt in Discord.
5. Exchanges the returned `code` at `https://discord.com/api/oauth2/token` (grant_type `authorization_code`, client_id, client_secret, redirect_uri `http://localhost`) for an `access_token`.
6. Sends `AUTHENTICATE` with `{ access_token }`.
7. Sends `GET_GUILDS`; for the first guild, `GET_CHANNELS` and prints voice channels (type 2 / 13).
8. Sends `SELECT_VOICE_CHANNEL` with a chosen `channel_id` — confirm your account joins in Discord. Then `SET_VOICE_SETTINGS` `{ mute: true }`, then `SELECT_VOICE_CHANNEL` with `channel_id: null` to disconnect.

Hard-code the client id/secret/channel id as constants at the top for the spike.

**Step 2:** Run it: `node spike/rpc-spike.mjs`

**Expected / success criteria (record findings in the design doc's "Known risk" section):**
- Socket connects; handshake returns READY.
- AUTHORIZE prompt appears in Discord and returns a code.
- Token exchange succeeds; AUTHENTICATE succeeds.
- GET_GUILDS / GET_CHANNELS return data; voice channels are filterable by `type`.
- `SELECT_VOICE_CHANNEL` visibly moves your account; mute toggles; null disconnects.

**Step 3:** Note the **PKCE question** for distribution: attempt `AUTHORIZE` with a `code_challenge`/`code_verifier` (PKCE S256) and the token exchange WITHOUT `client_secret`. Record whether RPC `AUTHORIZE` honors PKCE. This decides the distribution auth path (PKCE vs hosted exchange). Do not block v1 on it.

**Step 4: Commit**
```bash
git add spike/rpc-spike.mjs docs/plans/2026-06-09-discord-controller-voice-ui-design.md
git commit -m "spike: validate Discord RPC voice control end-to-end"
```

> **GATE:** Do not proceed past Task 0 until the spike confirms `SELECT_VOICE_CHANNEL` works. If it fails, stop and reassess with the user.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.ts`

**Step 1:** Initialize and install deps.
```bash
npm init -y
npm i electron-store
npm i -D electron electron-vite electron-builder typescript vitest @types/node
```

**Step 2:** Write `tsconfig.json` (strict, `moduleResolution: "bundler"`, `target: "ES2022"`, `types: ["node"]`).

**Step 3:** Write `electron.vite.config.ts` with `main`, `preload`, `renderer` entries pointing at the files above.

**Step 4:** Write `vitest.config.ts` (environment `node`, include `src/**/*.test.ts`).

**Step 5:** Minimal `src/main/index.ts` that creates a `BrowserWindow` loading the renderer; `src/preload/index.ts` exposing a no-op `window.api`; `src/renderer/main.ts` rendering "Hello". Add npm scripts: `"dev": "electron-vite dev"`, `"build": "electron-vite build"`, `"test": "vitest run"`, `"package": "electron-vite build && electron-builder"`.

**Step 6:** Verify it boots.
Run: `npm run dev`
Expected: a window showing "Hello".

**Step 7: Commit**
```bash
git add -A && git commit -m "chore: scaffold electron + typescript + vitest project"
```

---

## Task 2: RPC frame encode/decode (pure, TDD)

**Files:**
- Create: `src/main/discord/frame.ts`
- Test: `src/main/discord/frame.test.ts`

**Step 1: Write failing tests** in `frame.test.ts`:
```ts
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
```

**Step 2:** Run to confirm failure.
Run: `npx vitest run src/main/discord/frame.test.ts`
Expected: FAIL (module not found).

**Step 3:** Implement `frame.ts`:
```ts
export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

export interface DecodedMessage { op: number; data: any }

export function decodeFrames(buf: Buffer): { messages: DecodedMessage[]; rest: Buffer } {
  const messages: DecodedMessage[] = []
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
```

**Step 4:** Run tests — Expected: PASS.

**Step 5: Commit**
```bash
git add src/main/discord/frame.ts src/main/discord/frame.test.ts
git commit -m "feat: Discord IPC frame encode/decode"
```

---

## Task 3: Channel ranking + grouping (pure, TDD)

**Files:**
- Create: `src/main/ranking.ts`
- Test: `src/main/ranking.test.ts`

Implements the design's ordering: favorites pinned (manual order) on top, the rest ranked by usage `count` desc with `lastJoined` recency tiebreak, **grouped by server**.

**Step 1: Write failing tests** covering:
```ts
import { describe, it, expect } from 'vitest'
import { rankChannels, type VoiceChannel, type Store } from './ranking'

const ch = (id: string, guildId: string, guildName: string, name: string): VoiceChannel =>
  ({ id, guildId, guildName, name })

describe('rankChannels', () => {
  it('groups by server and pins favorites in manual order, then usage desc', () => {
    const channels = [
      ch('a', 'g1', 'Server One', 'General'),
      ch('b', 'g1', 'Server One', 'Gaming'),
      ch('c', 'g1', 'Server One', 'Music'),
    ]
    const store: Store = {
      favorites: ['c'],
      usage: { a: { count: 5, lastJoined: 100 }, b: { count: 10, lastJoined: 50 } },
    }
    const groups = rankChannels(channels, store)
    expect(groups.length).toBe(1)
    expect(groups[0].guildName).toBe('Server One')
    expect(groups[0].channels.map(c => c.id)).toEqual(['c', 'b', 'a']) // fav, then count 10, then 5
  })
  it('breaks usage ties by recency (lastJoined desc)', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: [], usage: { a:{count:3,lastJoined:1}, b:{count:3,lastJoined:9} } }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
  it('orders multiple favorites by their position in the favorites array', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: ['b','a'], usage: {} }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
  it('places unused non-favorite channels last (count 0)', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: [], usage: { b:{count:1,lastJoined:1} } }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
})
```

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `ranking.ts`:
```ts
export interface VoiceChannel { id: string; guildId: string; guildName: string; name: string }
export interface UsageEntry { count: number; lastJoined: number }
export interface Store { favorites: string[]; usage: Record<string, UsageEntry> }
export interface ServerGroup { guildId: string; guildName: string; channels: VoiceChannel[] }

export function rankChannels(channels: VoiceChannel[], store: Store): ServerGroup[] {
  const byGuild = new Map<string, ServerGroup>()
  for (const c of channels) {
    if (!byGuild.has(c.guildId)) byGuild.set(c.guildId, { guildId: c.guildId, guildName: c.guildName, channels: [] })
    byGuild.get(c.guildId)!.channels.push(c)
  }
  const favRank = new Map(store.favorites.map((id, i) => [id, i]))
  for (const group of byGuild.values()) {
    group.channels.sort((a, b) => {
      const fa = favRank.has(a.id), fb = favRank.has(b.id)
      if (fa && fb) return favRank.get(a.id)! - favRank.get(b.id)!
      if (fa) return -1
      if (fb) return 1
      const ua = store.usage[a.id] ?? { count: 0, lastJoined: 0 }
      const ub = store.usage[b.id] ?? { count: 0, lastJoined: 0 }
      if (ub.count !== ua.count) return ub.count - ua.count
      return ub.lastJoined - ua.lastJoined
    })
  }
  return [...byGuild.values()]
}
```

**Step 4:** Run — Expected: PASS.

**Step 5: Commit**
```bash
git add src/main/ranking.ts src/main/ranking.test.ts
git commit -m "feat: favorites-pinned, usage-ranked, server-grouped ordering"
```

---

## Task 4: Store update logic (pure core + electron-store wrapper, TDD on pure core)

**Files:**
- Create: `src/main/store-logic.ts` (pure), `src/main/store.ts` (electron-store wrapper)
- Test: `src/main/store-logic.test.ts`

**Step 1: Write failing tests** for pure reducers `recordJoin` and `toggleFavorite`:
```ts
import { describe, it, expect } from 'vitest'
import { recordJoin, toggleFavorite } from './store-logic'
import type { Store } from './ranking'

const empty: Store = { favorites: [], usage: {} }

describe('recordJoin', () => {
  it('increments count and sets lastJoined', () => {
    const s = recordJoin(empty, 'a', 123)
    expect(s.usage.a).toEqual({ count: 1, lastJoined: 123 })
    const s2 = recordJoin(s, 'a', 200)
    expect(s2.usage.a).toEqual({ count: 2, lastJoined: 200 })
  })
  it('does not mutate the input', () => {
    recordJoin(empty, 'a', 1); expect(empty.usage.a).toBeUndefined()
  })
})

describe('toggleFavorite', () => {
  it('adds when absent and removes when present', () => {
    const s = toggleFavorite(empty, 'a'); expect(s.favorites).toEqual(['a'])
    expect(toggleFavorite(s, 'a').favorites).toEqual([])
  })
})
```

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `store-logic.ts`:
```ts
import type { Store } from './ranking'

export function recordJoin(store: Store, channelId: string, now: number): Store {
  const prev = store.usage[channelId] ?? { count: 0, lastJoined: 0 }
  return { ...store, usage: { ...store.usage, [channelId]: { count: prev.count + 1, lastJoined: now } } }
}

export function toggleFavorite(store: Store, channelId: string): Store {
  const has = store.favorites.includes(channelId)
  return { ...store, favorites: has ? store.favorites.filter(id => id !== channelId) : [...store.favorites, channelId] }
}
```

**Step 4:** Run — Expected: PASS.

**Step 5:** Implement `store.ts`: thin `electron-store` wrapper with defaults `{ favorites: [], usage: {}, settings: {}, auth: null }`, exposing `get()`, `setFavorites`, `setUsage`, `getAuth`, `setAuth`. No new tests (delegates to tested pure logic + library).

**Step 6: Commit**
```bash
git add src/main/store-logic.ts src/main/store-logic.test.ts src/main/store.ts
git commit -m "feat: usage/favorites store reducers + electron-store wrapper"
```

---

## Task 5: DiscordRpcClient (socket + handshake + nonce correlation)

Hard to fully unit-test (real socket). Strategy: inject a socket-like transport so the protocol logic is testable with a fake; the real `net` socket is used in production.

**Files:**
- Create: `src/main/discord/rpc-client.ts`
- Create: `src/main/discord/socket-path.ts` (platform socket discovery)
- Test: `src/main/discord/rpc-client.test.ts`

**Step 1: Write failing tests** using a `FakeTransport` (EventEmitter with `write` + `connect`):
- `connect()` sends a HANDSHAKE frame containing `{ v: 1, client_id }`.
- `request(cmd, args)` writes a FRAME with a generated `nonce` and resolves when a message with the same `nonce` arrives; rejects when that message has `evt: "ERROR"`.
- incoming `DISPATCH` messages (no matching nonce) emit an `event` for subscribers.
- partial buffered data across two `data` events decodes correctly (reuses `decodeFrames`).

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `rpc-client.ts`:
- Constructor takes `{ clientId, transport }` where transport defaults to a real `net` connection factory.
- Maintain `private buffer = Buffer.alloc(0)`; on `data`, append, run `decodeFrames`, dispatch.
- `pending: Map<nonce, {resolve, reject}>`; `request` builds `{ cmd, args, nonce }`, writes `encodeFrame(OP.FRAME, …)`.
- Generate nonce without `Math.random`/`Date.now`: use `crypto.randomUUID()` (allowed — Node `crypto`).
- `subscribe(evt, args)` sends `{ cmd: 'SUBSCRIBE', evt, args, nonce }`; emit decoded DISPATCH events via an `EventEmitter`.
- Reconnect with capped backoff on socket close.

**Step 4:** Run — Expected: PASS.

**Step 5:** Implement `socket-path.ts`: enumerate candidate paths per platform (Win named pipes `discord-ipc-0..9`; unix dirs from `XDG_RUNTIME_DIR`/`TMPDIR`/`/tmp`/`/var/run` + snap/flatpak subpaths), return the first that connects. Small unit test for path-candidate generation given fake env (pure function `candidatePaths(env, platform)`).

**Step 6: Commit**
```bash
git add src/main/discord/rpc-client.ts src/main/discord/socket-path.ts src/main/discord/*.test.ts
git commit -m "feat: Discord RPC client with nonce correlation + socket discovery"
```

---

## Task 6: AuthManager (OAuth2 RPC handshake)

**Files:**
- Create: `src/main/discord/auth.ts`
- Test: `src/main/discord/auth.test.ts`

**Step 1: Write failing tests** with a mock RPC client + mock `fetch`:
- `authenticate()` reuses a cached valid token from `Store` (calls `AUTHENTICATE`, skips AUTHORIZE) when present and unexpired.
- with no token: calls `AUTHORIZE` → exchanges `code` via `fetch` → stores token → calls `AUTHENTICATE`.
- expired token triggers a fresh AUTHORIZE.

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `auth.ts`:
- `constructor({ rpc, store, clientId, clientSecret })`.
- `AUTHORIZE` scopes `['rpc','rpc.voice.read','rpc.voice.write']`.
- token exchange POST to `https://discord.com/api/oauth2/token`; store `{ accessToken, expiresAt }` (expiresAt computed from `expires_in`, with `now` passed in as a parameter so it stays testable — no `Date.now` inside pure paths).
- Leave a clearly marked seam (`exchangeCode`) so the distribution PKCE/hosted-exchange variant from Task 0 can swap in later.

**Step 4:** Run — Expected: PASS.

**Step 5: Commit**
```bash
git add src/main/discord/auth.ts src/main/discord/auth.test.ts
git commit -m "feat: OAuth2 RPC auth manager with token caching"
```

---

## Task 7: Main process orchestration + IPC bridge

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/service.ts` (wires rpc + auth + store + ranking; exposes high-level methods)
- Modify: `src/preload/index.ts`
- Create: `src/shared/ipc.ts` (channel name constants + payload types, shared by main/preload/renderer)

**Step 1:** Define `src/shared/ipc.ts`: typed channel names — `state:update` (main→renderer: `ServerGroup[]` + current channel + connection status), and invokes `voice:join`, `voice:disconnect`, `voice:setMute`, `voice:setDeafen`, `favorite:toggle`.

**Step 2:** Implement `service.ts`:
- On start: connect rpc → auth → fetch guilds/channels → `rankChannels` → push `state:update`.
- Subscribe to `VOICE_STATE_CREATE/UPDATE/DELETE` + `VOICE_CHANNEL_SELECT`; on change, recompute occupancy + current channel and push state.
- `join(channelId)`: `SELECT_VOICE_CHANNEL` → on success `recordJoin` (pass `Date.now()` here — main process side effect boundary, not in pure code) → persist → re-rank → push.
- `disconnect()`, `setMute(bool)`, `setDeafen(bool)`, `toggleFavorite(channelId)` (persist + re-rank + push).

**Step 3:** Wire `ipcMain.handle` for each invoke channel to `service` methods; `webContents.send('state:update', …)` for pushes. Expose them in preload via `contextBridge.exposeInMainWorld('api', …)`.

**Step 4:** Manual verify with Discord running.
Run: `npm run dev`
Expected: console/devtools shows a `state:update` with your real servers' voice channels grouped and ranked.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat: wire main-process Discord service + typed IPC bridge"
```

---

## Task 8: Renderer — render grouped channel list

**Files:**
- Create: `src/renderer/render.ts` (pure: state → DOM-description), `src/renderer/styles.css`
- Modify: `src/renderer/main.ts`
- Test: `src/renderer/render.test.ts`

**Step 1: Write failing tests** for a pure `buildView(state, selectionIndex)` that returns a flat list of rows (`{kind:'header'|'channel', …}`) from `ServerGroup[]`, marks the selected channel, marks favorites and the current channel, and shows occupancy count. Assert ordering: header then its channels, headers skipped by selection indexing.

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `render.ts` (pure transform) + a thin `main.ts` that subscribes to `window.api.onStateUpdate`, holds `selectionIndex`, and paints `buildView` output into the DOM. Style compact, dark, legible at a glance; status indicator; legend bar.

**Step 4:** Run tests — Expected: PASS. Then `npm run dev` to eyeball.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat: render server-grouped voice channel list"
```

---

## Task 9: Controller input + navigation

**Files:**
- Create: `src/renderer/navigation.ts` (pure reducer), `src/renderer/gamepad.ts` (Gamepad API loop)
- Modify: `src/renderer/main.ts`
- Test: `src/renderer/navigation.test.ts`

**Step 1: Write failing tests** for a pure `navigate(state, action)` reducer where actions are `UP|DOWN|GROUP_PREV|GROUP_NEXT` and state is `{ rows, selectionIndex }`:
- UP/DOWN move selection across channel rows, skipping headers, clamped at ends.
- GROUP_NEXT/PREV jump selection to the first channel of the next/prev server group.

**Step 2:** Run — Expected: FAIL.

**Step 3:** Implement `navigation.ts` (pure). Implement `gamepad.ts`: `requestAnimationFrame` poll loop reading `navigator.getGamepads()`, debouncing button edges (press, not hold) and stick→direction with a deadzone, emitting actions: Up/Down/bumpers → `navigate`; A → join selected; B → disconnect; X → toggle mute; Y → toggle deafen; Start → toggle favorite; Select/back-chord → show/hide. Keyboard fallback maps the same actions.

**Step 4:** Run tests — Expected: PASS. Manual: plug in a controller, navigate and join a channel via `npm run dev`.

**Step 5: Commit**
```bash
git add -A && git commit -m "feat: controller navigation + gamepad input loop"
```

---

## Task 10: Window behavior (frameless, always-on-top, toggle)

**Files:**
- Modify: `src/main/index.ts`

**Step 1:** Configure `BrowserWindow`: `frame: false`, `alwaysOnTop: true`, `skipTaskbar: false`, compact default size, remembered position via Store. Register a `globalShortcut` (e.g. `CommandOrControl+Shift+\``) to toggle visibility; also handle the renderer's show/hide action via IPC.

**Step 2:** Manual verify: window stays on top, hotkey toggles it.

**Step 3: Commit**
```bash
git add -A && git commit -m "feat: frameless always-on-top window with toggle hotkey"
```

---

## Task 11: Packaging + Steam (Non-Steam Game) docs

**Files:**
- Modify: `package.json` (electron-builder config block)
- Create: `docs/STEAM.md`

**Step 1:** Add `build` config to `package.json`: appId, product name, targets — Windows `nsis` + `portable`, macOS `dmg` (note: end users will likely self-sign/allow; document Gatekeeper), Linux `AppImage`. Set `asar: true`.

**Step 2:** Build artifacts.
Run: `npm run package`
Expected: installer/portable artifacts produced under `dist/`.

**Step 3:** Write `docs/STEAM.md`: how to add the built binary as a **Non-Steam Game** (Steam → Add a Game → Add a Non-Steam Game → browse to the exe/.app/AppImage), enable controller support per-game, and use it via the Steam overlay / Big Picture. Note that Discord desktop must be running.

**Step 4: Commit**
```bash
git add -A && git commit -m "build: electron-builder packaging + Steam non-Steam-game docs"
```

---

## Task 12: RPC approval application (parallel track, documentation)

**Files:**
- Create: `docs/DISTRIBUTION.md`

**Step 1:** Document the distribution path: submit Discord's RPC scope approval request for the application; record the PKCE-vs-hosted-exchange decision from Task 0; describe the BYO-client-ID fallback (user registers their own app, pastes client ID into settings) including the settings field needed. This task has no code dependency and can be done any time after Task 0.

**Step 2: Commit**
```bash
git add docs/DISTRIBUTION.md && git commit -m "docs: distribution + RPC approval plan"
```

---

## Definition of done (v1)

- Spike confirmed voice control works (Task 0 gate passed).
- `npm test` green; pure logic (frame, ranking, store reducers, navigation, render, auth) covered.
- With Discord running, the app lists voice channels grouped by server, favorites pinned + usage-ranked, shows occupancy, and a controller can join/switch/disconnect/mute/deafen with no Discord window in view.
- Packaged artifacts build and run when added to Steam as a Non-Steam Game.
- Distribution plan (approval + fallback) documented.
