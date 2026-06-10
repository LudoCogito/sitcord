# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains **only planning documents** — there is no
source code, `package.json`, build tooling, or git history yet (not even
`git init` has been run). The project is in the "design approved, not yet
implemented" phase.

- `2026-06-09-discord-controller-voice-ui-design.md` — the approved design doc
  (architecture, data flow, persistence schema, controller UX, error handling,
  testing strategy, packaging plan).
- `2026-06-09-discord-controller-voice-ui.md` — the task-by-task implementation
  plan, gated and ordered (Task 0 through Task 12). It begins with `> **For
  Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
  this plan task-by-task.` — follow that skill when picking up implementation
  work here.

Note: the implementation plan refers to the design doc by the path
`docs/plans/2026-06-09-discord-controller-voice-ui-design.md`, but the file
actually lives at the repo root — adjust any plan steps that reference that
path accordingly.

Read both documents before starting work; they are the source of truth for
architecture decisions until code exists to supersede them.

## What this project is

A cross-platform, controller-first Electron mini-UI for joining/switching/
controlling **Discord voice channels** (via Discord's local RPC/IPC API, not
the bot API) without bringing the main Discord client into view. Intended to
be run as a Steam "Non-Steam Game" so gamepad input and the Steam overlay work
during gameplay. Shows voice channels only, grouped by server, with manually
pinned favorites first and the rest ranked by tracked usage. Text channels,
DMs, and server/role management are explicitly out of scope for v1.

## Planned architecture (from the design doc)

Two-process Electron app:

- **Main process (Node.js)**
  - `DiscordRpcClient` — connects to the local Discord IPC socket
    (`\\?\pipe\discord-ipc-0` on Windows; unix socket under
    `$XDG_RUNTIME_DIR`/`TMPDIR`/`/tmp` on macOS/Linux), handles binary frame
    encode/decode (op + little-endian length + JSON), correlates
    request/response by nonce, subscribes to events, auto-reconnects with
    backoff.
  - `AuthManager` — OAuth2 RPC handshake (`AUTHORIZE` -> code -> token exchange
    -> `AUTHENTICATE`), caches the token via `Store`.
  - `Store` — local JSON persistence via `electron-store`:
    `{ favorites: [channelId...], usage: { [channelId]: {count, lastJoined} },
    settings: {...}, auth: {...} }`.
  - `service.ts` — orchestrates rpc + auth + store + ranking; pushes
    `state:update` to the renderer and handles `voice:join`,
    `voice:disconnect`, `voice:setMute`, `voice:setDeafen`,
    `favorite:toggle`.
- **Renderer process** — reads the Gamepad API, renders the server-grouped,
  favorites-then-usage-ranked voice channel list, sends intents to main over a
  `contextBridge` preload bridge (`src/preload`), receives `state:update`
  pushes. Keyboard fallback for development / no-gamepad.
- **Window** — frameless, always-on-top, compact, toggled via global hotkey +
  controller chord.

### Core pure-function modules (TDD, high test coverage by design)

These are deliberately implemented as pure functions so they can be unit
tested without Electron, a real socket, or a real Discord client:

- `src/main/discord/frame.ts` — IPC frame encode/decode (`encodeFrame`,
  `decodeFrames`, opcodes in `OP`).
- `src/main/ranking.ts` — `rankChannels(channels, store)`: groups channels by
  guild, pins favorites in manual order, then sorts the rest by usage `count`
  desc with `lastJoined` recency as the tiebreak.
- `src/main/store-logic.ts` — `recordJoin`, `toggleFavorite` reducers over the
  `Store` shape (immutable; no `Date.now()`/`Math.random()` inside — `now` is
  passed in).
- `src/renderer/render.ts` — `buildView(state, selectionIndex)`: state ->
  flat row list (`{kind:'header'|'channel', ...}`) for the DOM, marking
  selection, favorites, current channel, and occupancy.
- `src/renderer/navigation.ts` — `navigate(state, action)`: pure reducer for
  `UP|DOWN|GROUP_PREV|GROUP_NEXT` selection movement, skipping headers and
  jumping between server groups.

Side effects (sockets, `electron-store`, `Date.now()`, OAuth `fetch`,
`requestAnimationFrame` gamepad polling) live in thin wrappers around these
(`rpc-client.ts`, `auth.ts`, `store.ts`, `service.ts`, `gamepad.ts`) and are
not the primary unit-test targets — `rpc-client.ts` is tested via an injected
fake transport instead of a real socket.

## Discord RPC notes

- This uses Discord's **local RPC (IPC) socket** API (`GET_GUILDS`,
  `GET_CHANNELS`, `SELECT_VOICE_CHANNEL`, `SET_VOICE_SETTINGS`,
  `GET_SELECTED_VOICE_CHANNEL`, and `VOICE_CHANNEL_SELECT` /
  `VOICE_STATE_CREATE/UPDATE/DELETE` events) — distinct from, and not
  replaceable by, the Discord Bot API, which cannot move a user's own account.
- Voice channels = type `2`; stage channels = type `13`.
- RPC scopes (`rpc`, `rpc.voice.read`, `rpc.voice.write`) work immediately for
  the app owner/added testers against a self-registered Discord app.
  Authorizing arbitrary users requires Discord's RPC approval. Fallback if
  denied: a BYO-client-ID model (each user registers their own Discord app).
  See the design doc's "Known risk to resolve first (spike)" section and
  Task 12 of the implementation plan.
- The OAuth2 token exchange normally needs a `client_secret`, which is unsafe
  to embed in a distributed app. For personal/tester builds this is fine; for
  distribution, resolve via PKCE (if RPC `AUTHORIZE` supports it) or a hosted
  token-exchange endpoint — Task 0's spike is meant to determine which.

## Planned commands (once Task 1 scaffolding lands)

Per the implementation plan, the project will be set up with
`electron-vite` + TypeScript + Vitest + `electron-store` + `electron-builder`:

- `npm run dev` — launch the app in development (`electron-vite dev`).
- `npm test` / `npx vitest run` — run all unit tests.
- `npx vitest run src/path/to/file.test.ts` — run a single test file.
- `npm run build` — `electron-vite build`.
- `npm run package` — build + `electron-builder`, producing installers under
  `dist/` (Windows `nsis`/portable, macOS `dmg`, Linux `AppImage`).

The very first executable artifact is `spike/rpc-spike.mjs` (Task 0), a
standalone Node script run with `node spike/rpc-spike.mjs` — it has no
dependency on the npm scripts above and is throwaway/exploratory, not part of
the test suite.

## Working conventions from the implementation plan

- Tasks are ordered and gated: **Task 0 (the RPC spike) gates everything
  else** — do not proceed past it until `SELECT_VOICE_CHANNEL` and
  `SET_VOICE_SETTINGS` are confirmed working end-to-end against a real running
  Discord client. If the spike fails, stop and reassess with the user rather
  than continuing.
- New pure logic modules (frame, ranking, store-logic, render, navigation,
  auth) are written test-first: failing test added, confirmed to fail, then
  implementation added to make it pass.
- Each task ends with its own git commit using the message given in that
  task's "Commit" step. Since the repo has no git history yet, the first task
  that runs `git commit` will need `git init` first.
