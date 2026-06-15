# Sitcord — Release & Distribution Plan

A reference runbook for taking Sitcord from "works on my machine" to "other
people can download it and it auto-updates." Two independent tracks —
**Discord** (so the app is allowed to talk to Discord for users other than you)
and **GitHub** (so the app can be downloaded and can update itself) — plus
**code signing** (so the installers are trusted and macOS auto-update works at
all).

Nothing here has side effects until *you* run the marked commands. The app's
auto-update plumbing is already wired and idle; it stays a graceful no-op until a
real GitHub release exists.

---

## 0. Current state (already done)

- ✅ `electron-updater` wired in `src/main/updater.ts`, driven into the renderer's
  bottom-right corner indicator (version normally; yellow "Update available" when
  a newer release is detected).
- ✅ `build.publish` configured in `package.json`:
  `{ provider: "github", owner: "zeraphil", repo: "sitcord" }`.
- ✅ Licensed **Apache-2.0** (`LICENSE` + `NOTICE`, `package.json` `license`
  field). Update the `NOTICE` copyright holder from "The Sitcord Authors" to your
  legal/preferred name.
- ✅ `gh` CLI authenticated as `zeraphil` (scopes: `repo`, `workflow`).
- ⬜ Everything below.

**Decisions locked in:** repo will be `github.com/zeraphil/sitcord`, **public**,
created when you're ready to push.

---

## Track A — Discord setup

Why this exists: Sitcord uses Discord's **local RPC (IPC)** API. Your own Discord
app's RPC scopes work immediately **for you and explicitly-added testers**.
Letting *arbitrary* users authorize requires Discord's RPC approval, and
distributing the app at all means complying with Discord's Developer Terms — which
is what the Team / ToS / Privacy Policy pieces are for.

### A1. Create a Discord Team

Teams own apps (instead of a single user account), which is required for
verification and a prerequisite for RPC approval / distribution.

1. Go to the Discord Developer Portal → **Teams** → **New Team**.
   https://discord.com/developers/teams
2. Name it (e.g. "Sitcord" or your studio name).
3. You may need to verify your account email / set up 2FA if prompted.

### A2. Move the Sitcord app to the Team

1. Developer Portal → **Applications** → select your existing Sitcord app
   (the one whose `DISCORD_CLIENT_ID` is in `.env`).
2. **Settings → General Information → Transfer Ownership** (or "Transfer App to
   Team") → choose the Team from A1.
3. Confirm the `Application ID` is unchanged (it should be) so your existing
   `.env` keeps working.

> ⚠️ Do not regenerate the client secret unless you intend to. If you do, update
> `DISCORD_CLIENT_SECRET` in `.env` (never commit it).

### A3. Terms of Service & Privacy Policy

Required for a distributed app. They must be reachable URLs.

1. Write a short ToS and Privacy Policy. For a desktop app that stores data
   locally and only talks to Discord, the Privacy Policy mainly states: what's
   stored (favorites, usage counts, OAuth token — all local), that no data is
   sent anywhere except Discord's own API, and how to delete it (remove the
   app's config file / uninstall).
2. Host them somewhere stable — GitHub Pages, a Gist, or a plain page in the
   repo's `docs/`. Once the repo is public you can use raw GitHub URLs.
3. Developer Portal → Sitcord app → **General Information** → paste the
   **Terms of Service URL** and **Privacy Policy URL**.

### A4. OAuth2 / RPC configuration

1. Developer Portal → Sitcord app → **OAuth2**:
   - Confirm/record the **Client ID** (matches `DISCORD_CLIENT_ID`).
   - Under **Redirects**, the RPC handshake uses a redirect URI. The local RPC
     `AUTHORIZE` flow conventionally uses `http://localhost` — confirm the value
     the app's `AuthManager` sends matches a registered redirect URI here.
2. Scopes the app requests (already used by the code): `rpc`,
   `rpc.voice.read`, `rpc.voice.write`. No bot scope is needed — this is not the
   bot API.

### A5. Add testers (development / private testing)

Until RPC approval lands, only the app owner and added testers can authorize.

1. Developer Portal → Sitcord app → **App Testers** (or the Team members list).
2. Add the Discord accounts of anyone who needs to run a pre-approval build.

### A6. RPC approval (required for public, non-tester users)

This is the gate for "anyone can download and use it." It is a Discord review
process and can take time / be denied.

1. Developer Portal → Sitcord app → look for **RPC** / "Apply for RPC access"
   (Discord surfaces this under the app settings once the app is Team-owned and
   has ToS/Privacy URLs).
2. Submit the application describing what the app does (a controller-first voice
   channel switcher using `SELECT_VOICE_CHANNEL` / `SET_VOICE_SETTINGS`).
3. **Fallback if denied — BYO-client-ID model:** ship the app so each user
   registers *their own* Discord app and pastes their Client ID into Sitcord's
   settings. Their own app's RPC scopes work for them immediately, sidestepping
   approval. (See the design doc's "Known risk" section and Task 12.) Keep this
   path in mind as the contingency.

### A7. Resolve the `client_secret` distribution problem

The OAuth2 token exchange normally needs the `client_secret`, which is **unsafe
to embed in a distributed binary**. For your personal/tester builds it's fine
(it's in local `.env`). For public distribution, pick one before shipping:

- **PKCE** — if the RPC `AUTHORIZE` flow supports it, no secret needs to ship.
- **Hosted token-exchange endpoint** — a tiny server you run that holds the
  secret and does the code→token exchange for clients.
- **BYO-client-ID** (A6 fallback) — each user's own app, each user's own secret
  entered locally.

This is the Task 0 / Task 12 spike question; resolve it before a public release,
not before a private tester build.

---

## Track B — GitHub setup

### B1. (Done) License

Apache-2.0 is in place. Nothing to do unless you change the copyright holder in
`NOTICE`.

### B2. Create the public repo and push

Run when you're ready to go public. From the repo root:

```bash
# Sanity: make sure no secrets are about to ship. Should print nothing sensitive.
git ls-files | grep -iE '\.env$|client.?secret|token' || echo "clean"

# Create the public repo under zeraphil, add it as 'origin', and push.
gh repo create zeraphil/sitcord \
  --public \
  --source=. \
  --remote=origin \
  --description "Controller-first Electron mini-UI for Discord voice channels" \
  --push
```

Then push the feature branch and open a PR (or merge to `main` locally first —
your call):

```bash
git push -u origin feat/voice-ui-v1
# optionally: gh pr create --fill
```

> The `.gitignore` already excludes `.env`, `node_modules/`, `out/`, `dist/`,
> `.DS_Store`. Double-check `git status` is clean of secrets before the first
> push — the first push is the irreversible "it's public now" moment.

### B3. (Done) Publish provider config

`build.publish` already points at `zeraphil/sitcord`. Because the repo is
**public**, the installed app reads releases with **no embedded token** — this is
the simple path. (If you ever switch the repo to private, the app would need a
token at runtime; don't do that without changing this design.)

---

## Track C — Code signing

Independent of where you host. Hosting bytes ≠ making them trusted.

### C1. macOS (required for macOS auto-update)

Unsigned macOS apps **cannot auto-update** (Squirrel.Mac rejects them) and won't
pass Gatekeeper cleanly. To ship a real macOS auto-update story:

1. Enroll in the **Apple Developer Program** ($99/yr).
2. Create a **Developer ID Application** certificate; install it in your login
   keychain.
3. In `package.json` → `build.mac`, remove `"identity": null` (that currently
   *disables* signing) so electron-builder signs with your Developer ID.
4. Provide notarization credentials as env vars at build time:

   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"  # appleid.apple.com
   export APPLE_TEAM_ID="XXXXXXXXXX"
   ```

   electron-builder (v26) notarizes automatically when these are present.

> Skipping this is fine for personal/tester builds — macOS users would just
> update manually — but then the corner indicator is informational only on macOS.

### C2. Windows (recommended)

Auto-update works unsigned, but **SmartScreen warns on every unsigned install**.
To avoid that, sign the NSIS installer:

- Obtain a code-signing certificate (OV, or EV for instant SmartScreen
  reputation; or Azure Trusted Signing).
- Configure in `package.json` → `build.win` (`certificateFile` +
  `certificatePassword` via env, or the Azure Trusted Signing fields).

### C3. Linux

No signing needed. The **AppImage** target (already configured) auto-updates via
electron-updater as-is.

---

## Track D — Cutting a release

Do this each time you ship. The app only shows "Update available" once a release
with a **higher version than the installed copy** is published.

1. **Bump the version** in `package.json` (this is the number compared against
   `latest*.yml`):

   ```bash
   npm version patch   # or: minor / major  — updates package.json + creates a tag
   ```

2. **Build the renderer/main/preload bundles:**

   ```bash
   npm run build
   ```

3. **Build installers and publish to GitHub Releases** (uses the gh token; no
   need to store `GH_TOKEN` separately):

   ```bash
   GH_TOKEN=$(gh auth token) npx electron-builder --publish always
   ```

   This uploads, into one GitHub Release:
   - Installers: `Sitcord-Setup-<v>.exe` (NSIS), `Sitcord-<v>-portable.exe`,
     `Sitcord-<v>.dmg`, `Sitcord-<v>.AppImage`.
   - Update feeds: `latest.yml`, `latest-mac.yml`, `latest-linux.yml`
     (+ `.blockmap` files for delta downloads).

   > With macOS signing creds exported (C1), run this on macOS to get a notarized
   > `.dmg`. Cross-building signed mac artifacts from other OSes isn't supported.

4. **Publish the draft.** electron-builder uploads as a **draft** release by
   default so you can stage all platforms and write notes. Updaters do **not**
   see drafts — users only get the update once you click **Publish release** on
   GitHub (or `gh release edit <tag> --draft=false`).

### Optional convenience

Add a script to `package.json` so a release is one command:

```jsonc
"scripts": {
  "release": "electron-vite build && electron-builder --publish always"
}
```

Then: `npm version patch && GH_TOKEN=$(gh auth token) npm run release`.

---

## Track E — Verifying auto-update behavior

- **Dev (`npm run dev`) / no release yet:** corner shows `v1.0.0`, never goes
  yellow. The update check no-ops (not packaged / nothing newer). This is
  correct, not a bug.
- **After publishing a higher version:** install an older packaged build, launch
  it, and within a few seconds the corner turns yellow → "Update available"
  (`update-available` fired). With `autoDownload` on, it downloads in the
  background; the new version installs on next quit (electron-updater default).
- **To test the full flow** you need two real releases (an older installed build
  and a newer published one). You can't meaningfully test it from `dev`.

---

## Quick command reference

```bash
# Create public repo + push (one time, when ready)
gh repo create zeraphil/sitcord --public --source=. --remote=origin --push

# Cut a release (each ship)
npm version patch
npm run build
GH_TOKEN=$(gh auth token) npx electron-builder --publish always
gh release edit "v$(node -p "require('./package.json').version")" --draft=false

# Run tests / build locally
npm test
npm run build
```

## Environment variables

| Var | Where | Purpose | Committed? |
| --- | --- | --- | --- |
| `DISCORD_CLIENT_ID` | `.env` | RPC/OAuth app id | ❌ never |
| `DISCORD_CLIENT_SECRET` | `.env` | OAuth token exchange (personal/tester only) | ❌ never |
| `DISCORD_TEST_CHANNEL_ID` | `.env` | spike/dev target channel | ❌ never |
| `GH_TOKEN` | shell at publish time (`$(gh auth token)`) | upload release assets | ❌ never |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | shell at build time | macOS notarization | ❌ never |

## Ordering / gotchas

- **Public push is the irreversible step** — confirm no secrets are tracked
  first (`git ls-files | grep -i env`).
- **macOS auto-update needs signing+notarization** — without it, the macOS corner
  indicator is informational only.
- **Drafts don't notify** — remember to flip the release out of draft.
- **Version must increase** — a release that isn't higher than installed won't
  trigger the indicator.
- **Private repo would break tokenless updates** — keep it public, or redesign
  the feed (separate public releases repo / generic host) if that changes.
- **Discord RPC approval may be denied** — keep the BYO-client-ID fallback ready
  before promising public availability.
