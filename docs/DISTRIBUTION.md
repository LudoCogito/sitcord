# Distribution & Discord RPC access

Sitcord talks to the local Discord client over its RPC socket
using the `rpc`, `rpc.voice.read`, and `rpc.voice.write` scopes. These scopes
let an app read and change the user's voice connection (join/leave channels,
mute/deafen) — Discord treats them as **privileged** and gates them behind
either (a) the user being the developer/owner of the application, or (b) the
application having been granted RPC access via Discord's approval process.

This document covers the two distribution paths and the auth mechanism each
one uses.

## Path 1: Personal / tester builds (current default)

For development and for anyone willing to create their own Discord
application, no approval is needed — Discord allows the **owner** of an
application to use its privileged RPC scopes against their own account
without review.

Setup:

1. Create an application at <https://discord.com/developers/applications>.
2. Under OAuth2, add redirect URI `http://localhost`.
3. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` (from that
   application) in a local `.env` file — see `src/main/index.ts`, which loads
   them via `process.loadEnvFile`.

`AuthManager` (`src/main/discord/auth.ts`) performs the standard
`AUTHORIZE` → `exchangeCode` (client_secret-based token exchange) →
`AUTHENTICATE` flow, exactly as validated end-to-end in the Task 0 spike.
This is the simplest path and is fine as long as each user/tester registers
their own application — the secret never needs to be shared or shipped.

## Path 2: General distribution (packaged builds for other users)

Shipping a single packaged binary to arbitrary users means either:

- **submitting an RPC scope approval request** to Discord so *one*
  application (with one client ID) can be used by everyone, or
- **BYO client ID** — each user registers their own (free) Discord
  application and pastes its client ID into the app's settings, falling back
  to Path 1's per-owner allowance.

Both paths share the same problem: a `client_secret` embedded in a binary
that ships to many users is not safe (anyone can extract it). The Task 0
spike resolved how to avoid that.

### PKCE vs. hosted token exchange (Task 0 decision)

The spike (recorded in
`2026-06-09-discord-controller-voice-ui-design.md`, "Findings (Task 0
spike)") tested whether Discord's RPC `AUTHORIZE`/token-exchange supports
PKCE (`code_challenge`/`code_challenge_method: "S256"` on `AUTHORIZE`, then
`code_verifier` with **no `client_secret`** on the token exchange) as an
alternative to running a hosted backend that holds the secret.

**Result: PKCE works.** On a fresh (non-authenticated) RPC connection,
`AUTHORIZE` with a PKCE challenge succeeds, and `POST
/api/oauth2/token` succeeds with `code_verifier` and no `client_secret`.

**Decision: use PKCE for the distribution build. No hosted token-exchange
endpoint is required.** `AuthManager.exchangeCode`
(`src/main/discord/auth.ts:54`) is the deliberate seam for this swap — for
the distribution build it becomes a PKCE exchange (generate
`code_verifier`/`code_challenge` per `authorize()` call, pass
`code_challenge`/`code_challenge_method` in the `AUTHORIZE` RPC call, and
omit `client_id`'s secret + add `code_verifier` in the token POST). The rest
of `AuthManager`, `DiscordService`, and the RPC client are unaffected.

One caveat from the spike to carry into the PKCE implementation: calling
`AUTHORIZE` again on an **already-authenticated** RPC connection fails with
`ERROR 4002 "Already authenticated"`. Re-authenticating (e.g. after a token
expires) requires reconnecting the socket (new `HANDSHAKE`) before issuing a
fresh `AUTHORIZE` — `DiscordRpcClient`'s reconnect-with-backoff already
creates a new connection on transport close, so this falls out naturally as
long as `AuthManager.authenticate` is only called after a (re)connect, not
mid-session.

### Submitting the RPC scope approval request

To ship one application/client ID that works for all users without each of
them registering their own app, the application needs Discord's approval for
the `rpc`, `rpc.voice.read`, and `rpc.voice.write` scopes:

1. In the Developer Portal application used for the distributed build, fill
   out the app's basic info: name, description, icon, and a privacy
   policy/terms-of-service URL (Discord requires these for scope approval
   requests).
2. From the application's settings, submit the RPC scope approval / app
   verification request Discord provides for privileged RPC scopes,
   describing the use case: a desktop companion app that lets users switch
   their own Discord voice channel and toggle mute/deafen from a
   gamepad-driven UI (no access to messages, servers' data beyond voice
   channel lists/occupancy needed for the channel picker, etc.).
3. Until approval is granted, the distributed build can still be used by
   anyone via **Path 1 / BYO client ID** below — approval only removes the
   "register your own app" step for end users.

### BYO client ID fallback

Until (or instead of) RPC approval, users of a packaged build can supply
their own client ID:

1. The user creates a Discord application as in Path 1, step 1–2 (just the
   client ID is needed for PKCE — no secret).
2. They paste that client ID into a settings field in the app.

Implementation notes for when this is built:

- Add a `discordClientId: string | null` field to `AppData['settings']`
  (`src/main/store.ts`) — `settings` is already a free-form bag persisted via
  `electron-store`, so no schema migration is needed beyond reading/writing
  this key.
- `src/main/index.ts` currently reads `CLIENT_ID`/`CLIENT_SECRET` only from
  `process.env` (via `.env`). For the distributed build, fall back to
  `store.get().settings.discordClientId` when `DISCORD_CLIENT_ID` is unset,
  and skip `CLIENT_SECRET` entirely once `AuthManager` uses PKCE.
- A minimal settings UI (renderer) is needed to let the user paste/edit the
  client ID and trigger re-authentication — out of scope for v1, tracked here
  for whoever picks up the distribution build.
