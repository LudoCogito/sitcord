# Consolidated error reporting — design

Date: 2026-06-26
Status: design approved (pending written-spec review)

## Problem

Error handling is currently scattered and mostly invisible:

- `setupSession()` / auth failures in the main process land in `console.error`
  plus a `statusDetail` string on `AppState`, shown only as a small hint line on
  the "Can't reach Discord" menu screen.
- Operation errors (`join`, `setMute`, `setDeafen`, volume) reject back over IPC,
  but the renderer invokes them as `void window.api.join(...)`, so those
  rejections are **silently swallowed**.
- The gamepad poll loop has **no error handling** — a throw inside `poll()`
  silently kills the `requestAnimationFrame` loop and all controller input with
  it, with no signal to the user.
- There is no way for a user to report any of this back to us.

We want one consolidated error channel from both processes into a single panel,
with a one-tap way to send the error (message + full stack + context) to us.

## Guiding principle: critical only

The panel is reserved for errors that **break or terminate the experience** —
specifically, anything that kills the Discord connection/session or the
controller input loop. It must **never** fire for a transient, recoverable, or
auto-retried condition. A failed mute toggle, a single rejected RPC command, or
"Discord isn't running yet" must not interrupt the user.

**When in doubt, log it — don't surface it.**

## Error taxonomy

`ErrorReport.category`: `'connection' | 'controller' | 'unknown'`.

### Reported (opens the drawer)

| Trigger | Category | Why it's critical |
|---|---|---|
| Auth / `setupSession()` failure *after* a successful socket connect (e.g. `invalid_scope`, `invalid_client`) | `connection` | Session can't be established — no channels, app can't do its job. |
| Exception thrown inside the gamepad poll loop / input handler | `controller` | The rAF loop stops; controller input is dead until relaunch. |
| Uncaught renderer exception (`window.onerror`) | `unknown` | The UI has crashed. |

### Logged only (never opens the drawer)

- **Discord not running / socket connect fails** — the normal startup state;
  handled by the existing reconnect loop and the "Can't reach Discord" menu.
  `statusDetail` continues to drive that inline hint.
- **Clean mid-session disconnect** — handled by the existing menu + auto-reconnect.
  It escalates to a report *only* if the reconnect's `setupSession()` then fails
  (which is the `connection` row above).
- **Individual RPC command rejections while the socket is alive** — a
  `join`/`mute`/volume call Discord rejected but the user can retry. `console`
  only; the action just didn't take.
- **Per-guild channel / icon fetch failures** — already isolated and swallowed
  in `loadChannels()` / `loadGuildIcons()`.

To keep recoverable rejections from leaking out as `unhandledrejection` popups,
the renderer's fire-and-forget `window.api.*` calls get an explicit
`.catch()` (currently written as bare `void window.api.join(...)`).

## Architecture / flow

```
main process errors ─┐
 (auth / setupSession)│   IPC: ERROR_REPORT (main → renderer push)
                      ├───────────────────────────────▶  renderer error drawer
renderer errors ──────┘                                   (auto-opens)
 (gamepad loop, window.onerror)                                │
                                                               │ A = Submit
                                                IPC: ERROR_SUBMIT (renderer → main invoke)
                                                               ▼
                                                        submitReport() stub
                                                        (mailto: + clipboard)
```

- **Main → renderer:** `DiscordService` gains an injected `onError(report)`
  callback (mirrors the existing `onStateUpdate`). `index.ts` forwards it to the
  window over a new `ERROR_REPORT` channel through a `sendError()` funnel with
  the same destroyed-window guard as `sendState()`, and caches the last report
  so a reopened window can replay it (same pattern as `lastState`).
- **Renderer-local errors** (gamepad loop crash, `window.onerror`) are built into
  the same `ErrorReport` shape and fed straight into the drawer — no round-trip.
- **Submit:** the renderer sends the report back over `ERROR_SUBMIT` (invoke) to
  `submitReport()` in main.

## Data shape (`src/shared/ipc.ts`)

```ts
export interface ErrorReport {
  id: string            // unique id (for replace/replay keying)
  category: 'connection' | 'controller' | 'unknown'
  title: string         // short human headline, e.g. "Couldn't connect to Discord"
  message: string       // the error message
  stack?: string        // full stack trace, when available
  context: {            // self-contained so a report needs no extra lookup
    version: string     // app version
    platform: string    // process.platform
    [key: string]: unknown
  }
  timestamp: number      // ms epoch (passed in, not read inside the builder)
}
```

New IPC channels added to the `IPC` map: `ERROR_REPORT` (`'error:report'`,
main → renderer push) and `ERROR_SUBMIT` (`'error:submit'`, renderer → main invoke).

Preload bridge gains `onErrorReport(cb)` and `submitErrorReport(report)`.

## `buildErrorReport` — pure helper

`src/shared/error-report.ts`:

```ts
buildErrorReport(
  err: unknown,
  category: ErrorReport['category'],
  context: ErrorReport['context'],
  now: number,
  id: string
): ErrorReport
```

Pure (no `Date.now()` / `randomUUID()` inside — `now` and `id` are passed in, per
the repo's no-side-effects-in-logic convention). Normalizes a thrown value into
`{ title, message, stack }`: an `Error` contributes `message` + `stack`; a
non-Error is stringified. `title` is derived from `category` (a fixed
human-readable headline per category). Used by both processes.

## The error drawer (renderer)

Structurally mirrors the existing help drawer (`renderHelpDrawer` / `setHelpOpen`):

- `renderErrorDrawer()` builds `.error-backdrop > .error-panel`, lives in the DOM
  full-time, hidden until open; `setErrorOpen(bool)` flips the `.open` class and
  CSS animates the slide/fade. Reuses the help-drawer CSS structure with an
  error-themed accent (`--danger`).
- **Latest-error-only** (no queue): the renderer holds a single
  `currentError: ErrorReport | null`. A new report replaces it and (re)opens the
  drawer. Dismiss clears it and closes.
- **Auto-opens:** the `onErrorReport` handler sets `currentError` and calls
  `setErrorOpen(true)`. Renderer-local capture points do the same directly.
- **Contents:** the `title`, the `message`, a collapsible "Details" block holding
  the full `stack` + `context`, and two controller-glyph buttons —
  **(A) Submit**, **(B) Dismiss** — built with the same `glyphsFor(...)` /
  `makeChip(...)` helpers as the rest of the UI.
- **Input:** a new branch in `handleAction`, checked alongside the existing
  `helpOpen` block, makes the error drawer the top modal layer while open — `A`
  submits, `B`/Esc and backdrop-click dismiss, everything else is swallowed
  (matches how `helpOpen` gates input today). Checked before `helpOpen` so an
  error takes precedence over the settings drawer.

## Renderer-local error capture

- **Gamepad loop:** wrap the body of `poll()` in `try/catch`. On a throw, build a
  `controller` report, surface it via the drawer, and **stop the loop** (it's
  already dead) rather than rescheduling into a tight error spin. The report makes
  the otherwise-silent failure visible.
- **Uncaught UI errors:** a `window.onerror` handler builds an `unknown` report.
  (`unhandledrejection` is intentionally *not* a capture point — the fire-and-forget
  `window.api.*` calls get their own `.catch()` so recoverable rejections don't
  reach it; wiring it as a global trap would risk surfacing exactly the
  non-critical noise this design excludes.)

## Submission stub (`src/main/error-report.ts`)

`submitReport(report: ErrorReport): Promise<void>` — the swappable seam.

For now it does two things:

1. **`mailto:`** — builds `mailto:bug@sitcord.com?subject=...&body=...` with the
   report URL-encoded, and opens the user's default mail client via
   `shell.openExternal(...)`. The body is **truncated to a safe length** (~1500
   chars) because `mailto:` bodies have practical limits (Windows caps the whole
   command near ~2 KB and some clients clip), with a "…(truncated; full report on
   your clipboard)" marker when it's cut.
2. **Clipboard** — copies the **full, untruncated** report to the clipboard via
   Electron's `clipboard.writeText(...)` as a safety net, so nothing is lost if
   the mail client clips the body.

A clearly-marked `TODO` block above it lists the deferred real targets (Discord
webhook / prefilled GitHub issue / hosted endpoint) so swapping the destination
later is a one-function change. `index.ts` registers the `ERROR_SUBMIT` handler →
`submitReport`.

## Testing (TDD, per repo conventions)

New pure modules are written test-first:

- **`buildErrorReport`** (`src/shared/error-report.test.ts`) — Error vs. non-Error
  input, stack capture, context merge, title-per-category, deterministic output
  given fixed `now`/`id`.
- **`service.test.ts`** (extend existing fake-RPC tests):
  - `onError` fires with a `connection` report when `setupSession()` / auth
    rejects *after* a connect.
  - `onError` does **not** fire when the initial socket connect fails (the
    "Discord not running" path) — that stays the disconnected menu.
  - A recoverable RPC command rejection (`join`) does **not** fire `onError`.

`submitReport` (shell/clipboard side effects) and the DOM drawer are not primary
unit-test targets, consistent with the existing split between pure logic and thin
side-effecting wrappers.

## Out of scope

- The real submission destination (deferred — mailto stub stands in).
- An error queue / history (latest-error-only by decision).
- Persisting reports to disk or a log file.
- Reporting non-critical/recoverable conditions.
