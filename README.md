<div align="center">
  <img src="build/icon.png" alt="Sitcord" width="96" height="96" />
  <h1>Sitcord</h1>
  <p><strong>Switch and control Discord voice channels with your game controller — without pulling the full Discord client into view.</strong></p>

  [![CI](https://github.com/LudoCogito/sitcord/actions/workflows/ci.yml/badge.svg)](https://github.com/LudoCogito/sitcord/actions/workflows/ci.yml)
  [![Latest release](https://img.shields.io/github/v/release/LudoCogito/sitcord?display_name=tag)](https://github.com/LudoCogito/sitcord/releases/latest)
  [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
</div>

---

Sitcord is a free, open-source, cross-platform Electron mini-UI for joining,
switching, and controlling **Discord voice channels** via Discord's local
RPC/IPC interface (not the bot API). It's built to run as a Steam "Non-Steam
Game" so gamepad input and the Steam overlay keep working during gameplay. It
shows voice channels only — grouped by server, pinned favorites first, the rest
ranked by how often you use them.

> **Independent & unofficial.** Sitcord is not affiliated with or endorsed by
> Discord Inc. Your use of Discord remains subject to Discord's
> [Terms](https://discord.com/terms) and [Privacy Policy](https://discord.com/privacy).

## Download

Grab the latest installer for your platform from the
**[Releases page](https://github.com/LudoCogito/sitcord/releases/latest)**:

| Platform | Asset |
| --- | --- |
| Windows | `Sitcord-Setup-<version>.exe` (installer) or `Sitcord-<version>-portable.exe` |
| macOS | `Sitcord-<version>.dmg` |
| Linux | `Sitcord-<version>.AppImage` |

The app checks GitHub for newer releases and surfaces an "Update available"
indicator in its bottom-right corner.

> macOS/Windows builds are currently **unsigned**, so you may see a Gatekeeper
> or SmartScreen warning on first launch. See [code signing](#code-signing).

## Controls

| Action | Controller | Keyboard |
| --- | --- | --- |
| Move selection | Left stick / D-pad ▲▼ | ↑ / ↓ |
| Previous / next server group | LB / RB (tap) | ← / → |
| Join / collapse | A | Enter / `a` |
| Pick up server to reorder | Hold A | `g` |
| Disconnect | B | Esc / `b` |
| Toggle mute | X | `x` |
| Toggle deafen | Y | `y` |
| Mic volume down / up | LB + D-pad ◀ / ▶ | `[` / `]` |
| Discord volume down / up | RB + D-pad ◀ / ▶ | `;` / `'` |
| Zoom out / in / reset | LT / RT | `-` / `=` / `0` |
| Toggle favorite | Start | `f` |
| Help | View/Share | `h` |
| Show / hide window | LB + R3 (chord) | Tab |

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev          # launch the app in development
npm test             # run the unit test suite (Vitest)
npx vitest run path/to/file.test.ts   # run a single test file
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm run build        # build main/preload/renderer bundles
```

The architecture (two-process Electron, pure-logic modules + thin side-effecting
wrappers, Discord RPC details) is documented in [`CLAUDE.md`](CLAUDE.md).

## Building installers locally

```bash
npm run package      # electron-vite build + electron-builder -> dist/
```

## Releasing

CI builds and publishes releases automatically. To cut one:

```bash
npm version patch            # bump package.json + create the vX.Y.Z tag
git push --follow-tags       # triggers .github/workflows/release.yml
```

The [release workflow](.github/workflows/release.yml) builds installers on
macOS, Windows, and Linux and uploads them (plus the `latest*.yml` auto-update
feeds) to a **draft** GitHub Release. Review it and click **Publish release** —
updaters only see published releases.

The full runbook (Discord app/RPC approval, signing, distribution channels) is
in [`2026-06-14-release-and-distribution-plan.md`](2026-06-14-release-and-distribution-plan.md)
and [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).

### Code signing

Builds are unsigned by default. The release workflow has signing/notarization
steps pre-wired but commented out — add the documented repo secrets and
uncomment them (and remove `"identity": null` from `package.json` → `build.mac`)
to enable. macOS auto-update requires a signed + notarized build.

## Legal

- [Privacy Policy](PRIVACY.md) · [online version](https://ludocogito.github.io/sitcord/privacy.html)
- [Terms of Service](TERMS.md) · [online version](https://ludocogito.github.io/sitcord/terms.html)
- Licensed under [Apache-2.0](LICENSE) (see [`NOTICE`](NOTICE)).

## Support the project

If Sitcord is useful to you, you can support it via the **Sponsor** button on
this repo (GitHub Sponsors / Buy Me a Coffee).
