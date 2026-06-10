# Discord Controller Voice UI — Design

**Date:** 2026-06-09
**Status:** Approved (design phase)

## Summary

A cross-platform, controller-first mini UI that lets you join, switch, and
control Discord **voice channels** without bringing the main Discord window into
view. Designed to be launched as a **Non-Steam Game** so controller input and
the Steam overlay work naturally during gameplay.

Because controller use is assumed, the UI shows **only voice channels**,
**grouped by server**, with **manually pinned favorites on top** and the
remainder ranked by tracked usage.

## Goals

- Controller-driven navigation and voice control — no mouse/keyboard required.
- Voice actions: **join / switch channel**, **disconnect**, **mute/deafen self**,
  and **see who is currently in each channel**.
- Voice channels only, grouped by server, favorites-first then usage-ranked.
- Cross-platform (Windows / macOS / Linux + Steam Deck).
- Distributable to other users (eventually).

## Non-Goals (YAGNI for v1)

- Text channels, DMs, message reading/sending.
- Server/role management.
- Themes/skins, Steam Workshop, full Steam-partner publishing.

## Control mechanism

Discord's desktop client exposes a **local RPC (IPC) API** used by overlays and
game integrations. Relevant commands:

- `GET_GUILDS`, `GET_CHANNELS` — enumerate servers and their voice channels.
- `SELECT_VOICE_CHANNEL` — join (or, with `null`, disconnect) as the current user.
- `SET_VOICE_SETTINGS` — toggle self mute / deafen.
- `GET_SELECTED_VOICE_CHANNEL` — current channel.
- Events: `VOICE_CHANNEL_SELECT`, `VOICE_STATE_CREATE/UPDATE/DELETE` (occupancy).

This is distinct from the Bot API (which cannot move *your* account).

### Distribution gate (external dependency)

The RPC scopes (`rpc`, `rpc.voice.read`, `rpc.voice.write`) work immediately for
the **application owner + added testers** against a self-registered Discord app.
Authorizing **arbitrary users** requires Discord to **whitelist/approve** the
application. Plan: build now, **submit the RPC approval request in parallel**,
keep the design approval-agnostic. Fallback if denied: a **BYO client-ID** model
where each user registers their own free Discord app.

## Stack

**Electron** (cross-platform, mature auto-update via `electron-updater`, well-
trodden "add as Non-Steam Game" path). Tauri was considered for smaller binaries
but deferred to keep v1 low-risk. No corner-painting that blocks a later move.

## Architecture

Two-process Electron app:

- **Main process (Node.js)**
  - `DiscordRpcClient`: connects to the local Discord IPC socket
    (`\\?\pipe\discord-ipc-0` on Windows; unix socket under `$XDG_RUNTIME_DIR`
    / `/tmp` on macOS/Linux). Handles binary framing (op + length + JSON),
    correlates request/response by nonce, subscribes to events, auto-reconnects
    with backoff.
  - `AuthManager`: OAuth2 RPC handshake (`AUTHORIZE` -> token -> `AUTHENTICATE`),
    caches token.
  - `Store`: local JSON persistence via `electron-store`.
- **Renderer process**: the mini UI. Reads the **Gamepad API**, renders the
  grouped channel list, sends intents to main over a `contextBridge` preload
  bridge, receives state pushes.
- **Window**: frameless, always-on-top, compact. Show/hide via global hotkey +
  controller chord.

## Data flow

1. Launch -> main connects to Discord IPC, runs auth handshake
   (`rpc`, `rpc.voice.read`, `rpc.voice.write`).
2. `GET_GUILDS` -> per guild `GET_CHANNELS`, filtered to **voice (type 2)** and
   **stage (type 13)** only.
3. Merge with `Store`: favorites pinned (manual order) on top; rest ranked by
   usage (count desc, recency tiebreak); **grouped by server**.
4. Subscribe to `VOICE_STATE_*` per channel for live occupancy; subscribe to
   `VOICE_CHANNEL_SELECT` for current channel.
5. Renderer renders; gamepad drives selection.
6. **Join** -> `SELECT_VOICE_CHANNEL` -> on success bump usage count +
   lastJoined. **Disconnect** -> `SELECT_VOICE_CHANNEL(null)`.
   **Mute/deafen** -> `SET_VOICE_SETTINGS`.

## Controller UX (defaults — adjustable)

- Up/Down (stick or D-pad): move selection through the group-aware list
  (skips headers).
- **L/R bumpers:** jump between server groups.
- **A:** join selected · **B:** disconnect · **X:** toggle mute ·
  **Y:** toggle deafen.
- **Start:** toggle favorite on selected · **Select/Back (or chord):** show/hide.
- On-screen legend, connection-status indicator, "you are here" highlight.
- Each row: channel name, occupancy count, member names/avatars, favorite star.
- Keyboard fallback for development and no-gamepad cases.

## Persistence

`electron-store` JSON:

```
{
  favorites: [channelId, ...],          // manual order
  usage: { [channelId]: { count, lastJoined } },
  settings: { ... },
  auth: { ... }                          // cached token
}
```

Ranking/grouping implemented as **pure functions**, isolated for unit testing.

## Known risk to resolve first (spike)

The OAuth2 RPC token exchange normally needs a **client_secret**, unsafe to embed
in a distributed desktop app. Personal/tester build: fine (own app). Distribution:
resolve via **PKCE** (if RPC `AUTHORIZE` supports it) or a tiny **hosted token-
exchange** endpoint.

**First spike** (de-risk before UI work): confirm the auth flow and that
`SELECT_VOICE_CHANNEL` / `SET_VOICE_SETTINGS` work end-to-end against a real
local Discord client with a self-registered app.

## Error handling

- Discord not running / socket absent -> "Discord not detected, retrying" +
  backoff reconnect.
- Auth denied/expired -> re-prompt authorize.
- Command failure -> transient toast; no state corruption.
- Channels left/removed -> reconciled on each `GET_GUILDS` refresh.
- No gamepad -> keyboard fallback.

## Testing

- **Unit (TDD):** ranking, grouping, store, RPC frame encode/decode — pure,
  high-coverage.
- **Integration:** mock `DiscordRpcClient` for renderer flows.
- **Manual:** real Discord for voice actions (not cleanly automatable); the spike
  doubles as this.

## Packaging / Steam

`electron-builder` -> per-OS installers + portable builds. Distribute as a
**Non-Steam Game** (add the `.exe` / `.app` / AppImage). Document Big Picture
controller configuration. Full Steam-partner publishing is out of scope for v1.
