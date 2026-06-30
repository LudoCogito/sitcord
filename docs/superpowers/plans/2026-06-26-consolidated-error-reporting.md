# Consolidated Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Funnel session-breaking errors from both Electron processes into one help-drawer-style panel with a one-tap "submit to us" action.

**Architecture:** A pure `buildErrorReport` helper normalizes any thrown value into a shared `ErrorReport`. The main-process `DiscordService` emits reports via an injected `onError` callback for auth/setup failures; `index.ts` pushes them to the renderer over a new `ERROR_REPORT` IPC channel. The renderer also captures its own crashes (gamepad loop, uncaught UI errors) into the same drawer. Submit sends the report back over `ERROR_SUBMIT` to a swappable `submitReport` stub that opens a prefilled `mailto:` and copies the full report to the clipboard.

**Tech Stack:** TypeScript (strict), Electron, electron-vite, Vitest, contextBridge preload.

## Global Constraints

- **Prettier style (enforced):** no semicolons, single quotes, 2-space indent. All new code must match or `npm run format:check` fails.
- **Pure logic modules take no ambient side effects:** no `Date.now()` / `randomUUID()` *inside* `src/shared/error-report.ts` — `now` and `id` are passed in (matches the repo's `store-logic`/`ranking` convention). App-runtime code (`main.ts`, `service.ts`, `index.ts`) may call `Date.now()` / `randomUUID()`.
- **Critical-only:** the drawer fires only for errors that break the connection/session or kill the controller input loop. Recoverable conditions (failed single RPC command, Discord-not-running) are logged, never surfaced.
- **Submit target:** `bug@sitcord.com` (stub; swappable in one function).
- **Test commands:** all tests `npm test`; single file `npx vitest run <path>`. Type check `npm run typecheck`. Lint `npm run lint`. Format check `npm run format:check`.
- **Node 22, TypeScript strict.** Follow existing import ordering (node builtins → local).
- Repo has git history; commit per task with the message shown. Current branch: `feat/voice-ui-v1`.

---

### Task 1: Shared `ErrorReport` type, IPC channels, and `buildErrorReport`

**Files:**
- Modify: `src/shared/ipc.ts`
- Create: `src/shared/error-report.ts`
- Test: `src/shared/error-report.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ErrorReport { id: string; category: 'connection' | 'controller' | 'unknown'; title: string; message: string; stack?: string; context: { version: string; platform: string; [key: string]: unknown }; timestamp: number }`
  - `IPC.ERROR_REPORT = 'error:report'`, `IPC.ERROR_SUBMIT = 'error:submit'`
  - `buildErrorReport(err: unknown, category: ErrorReport['category'], context: ErrorReport['context'], now: number, id: string): ErrorReport`

- [ ] **Step 1: Add the `ErrorReport` type and IPC channels to `src/shared/ipc.ts`**

Add this interface after the existing `UpdateStatus` interface:

```ts
// A single critical error surfaced to the user in the error drawer and, on
// submit, sent to us. category drives the headline; context is self-contained
// so a report needs no extra lookup.
export interface ErrorReport {
  id: string
  category: 'connection' | 'controller' | 'unknown'
  title: string
  message: string
  stack?: string
  context: {
    version: string
    platform: string
    [key: string]: unknown
  }
  timestamp: number
}
```

Add two entries to the `IPC` object (before the closing `} as const`, after `RETRY_CONNECTION`):

```ts
  RETRY_CONNECTION: 'discord:retry',
  // Critical-error channel: main pushes a report; renderer submits one back.
  ERROR_REPORT: 'error:report',
  ERROR_SUBMIT: 'error:submit'
```

(Note: add the comma after `'discord:retry'`.)

- [ ] **Step 2: Write the failing test** at `src/shared/error-report.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildErrorReport } from './error-report'

const ctx = { version: '0.1.3', platform: 'darwin' }

describe('buildErrorReport', () => {
  it('captures message and stack from an Error and sets the category title', () => {
    const err = new Error('OAuth2 Error: invalid_scope')
    const report = buildErrorReport(err, 'connection', ctx, 1000, 'id-1')

    expect(report.id).toBe('id-1')
    expect(report.category).toBe('connection')
    expect(report.title).toBe("Couldn't connect to Discord")
    expect(report.message).toBe('OAuth2 Error: invalid_scope')
    expect(report.stack).toBe(err.stack)
    expect(report.context).toEqual(ctx)
    expect(report.timestamp).toBe(1000)
  })

  it('stringifies a non-Error value and leaves stack undefined', () => {
    const report = buildErrorReport('boom', 'controller', ctx, 2000, 'id-2')

    expect(report.title).toBe('Controller input stopped')
    expect(report.message).toBe('boom')
    expect(report.stack).toBeUndefined()
  })

  it('uses the generic title for the unknown category', () => {
    const report = buildErrorReport(new Error('x'), 'unknown', ctx, 0, 'id-3')
    expect(report.title).toBe('Something went wrong')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/shared/error-report.test.ts`
Expected: FAIL — `Failed to resolve import "./error-report"` / `buildErrorReport is not a function`.

- [ ] **Step 4: Implement `src/shared/error-report.ts`**

```ts
import type { ErrorReport } from './ipc'

// Human-readable headline per category, shown at the top of the error drawer.
const TITLES: Record<ErrorReport['category'], string> = {
  connection: "Couldn't connect to Discord",
  controller: 'Controller input stopped',
  unknown: 'Something went wrong'
}

// Normalize any thrown value into an ErrorReport. Pure: `now` and `id` are
// passed in so callers (main + renderer) own the side effects.
export function buildErrorReport(
  err: unknown,
  category: ErrorReport['category'],
  context: ErrorReport['context'],
  now: number,
  id: string
): ErrorReport {
  const isError = err instanceof Error
  return {
    id,
    category,
    title: TITLES[category],
    message: isError ? err.message : String(err),
    stack: isError ? err.stack : undefined,
    context,
    timestamp: now
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/shared/error-report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Type check, format check, commit**

```bash
npm run typecheck && npm run format:check
git add src/shared/ipc.ts src/shared/error-report.ts src/shared/error-report.test.ts
git commit -m "feat: ErrorReport type, IPC channels, and buildErrorReport helper"
```

---

### Task 2: `DiscordService` emits connection/setup errors via `onError`

**Files:**
- Modify: `src/main/service.ts`
- Test: `src/main/service.test.ts`

**Interfaces:**
- Consumes: `buildErrorReport`, `ErrorReport` (Task 1).
- Produces: `DiscordServiceOptions` gains optional `onError?: (report: ErrorReport) => void` and `appContext?: { version: string; platform: string }`. The service calls `onError` exactly once when `setupSession()` fails after a successful connect, with `category: 'connection'`. It does **not** call `onError` for an initial socket-connect failure, nor for a rejected user-action RPC command.

- [ ] **Step 1: Write the failing tests** — append to `src/main/service.test.ts`

First, extend the `makeService` helper so it captures errors and supplies the new options. Replace the existing `makeService` function with:

```ts
function makeService(
  states: AppState[],
  store: MemoryStore,
  errors: ErrorReport[] = []
): { service: DiscordService; rpc: FakeRpc } {
  const rpc = new FakeRpc(responses)
  const service = new DiscordService({
    rpc,
    store,
    clientId: 'cid',
    clientSecret: 'secret',
    onStateUpdate: (s) => states.push(s),
    onError: (r) => errors.push(r),
    appContext: { version: 'test', platform: 'test' },
    now: () => 0
  })
  return { service, rpc }
}
```

Add `import type { AppState, ErrorReport } from '../shared/ipc'` (replace the existing `AppState`-only import on line 4).

Then add these tests inside the `describe('DiscordService', ...)` block:

```ts
  it('emits a connection ErrorReport when setupSession fails after connect', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      AUTHENTICATE: () => {
        throw new Error('OAuth2 Error: invalid_scope')
      }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })

    await service.start()

    expect(errors).toHaveLength(1)
    expect(errors[0].category).toBe('connection')
    expect(errors[0].message).toContain('invalid_scope')
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('does NOT emit an ErrorReport when the initial socket connect fails', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc(responses)
    rpc.connect = async () => {
      throw new Error('ENOENT: discord not running')
    }
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })

    await service.start()

    expect(errors).toHaveLength(0)
    expect(states.at(-1)?.status).toBe('disconnected')
  })

  it('does NOT emit an ErrorReport when a user-action RPC command rejects', async () => {
    const states: AppState[] = []
    const errors: ErrorReport[] = []
    const store = new MemoryStore(
      { accessToken: 'tok', expiresAt: Infinity },
      { favorites: [], usage: {} }
    )
    const rpc = new FakeRpc({
      ...responses,
      SELECT_VOICE_CHANNEL: () => {
        throw new Error('rejected join')
      }
    })
    const service = new DiscordService({
      rpc,
      store,
      clientId: 'cid',
      clientSecret: 'secret',
      onStateUpdate: (s) => states.push(s),
      onError: (r) => errors.push(r),
      appContext: { version: 'test', platform: 'test' },
      now: () => 0
    })
    await service.start()

    await service.join('c1').catch(() => {})

    expect(errors).toHaveLength(0)
  })
```

Also add the two new options to the two pre-existing inline `new DiscordService({ ... })` constructions in this file (the "reads initial mute/deafen…" and "reads initial input/output volume…" tests). In each, add these two lines after `onStateUpdate: (s) => states.push(s),`:

```ts
      onError: () => {},
      appContext: { version: 'test', platform: 'test' },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/service.test.ts`
Expected: FAIL — `onError`/`appContext` not in `DiscordServiceOptions` (type error), and the "emits a connection ErrorReport" test fails because nothing calls `onError` yet.

- [ ] **Step 3: Implement the service changes** in `src/main/service.ts`

Add imports at the top (after the existing imports):

```ts
import { randomUUID } from 'node:crypto'
import { buildErrorReport } from '../shared/error-report'
```

Update the `AppState` import to also bring in `ErrorReport`:

```ts
import type { AppState, ConnectionStatus, ErrorReport } from '../shared/ipc'
```

Add two fields to `DiscordServiceOptions`:

```ts
  onStateUpdate: (state: AppState) => void
  // Critical errors (auth/session setup failures) for the error drawer. Optional
  // so tests and the initial wiring can omit it.
  onError?: (report: ErrorReport) => void
  // Baked into every report's context so it's self-contained.
  appContext?: { version: string; platform: string }
  now?: () => number
```

Add two private fields and assign them in the constructor:

```ts
  private readonly onError?: (report: ErrorReport) => void
  private readonly appContext: { version: string; platform: string }
```

In the constructor body (alongside `this.onStateUpdate = options.onStateUpdate`):

```ts
    this.onError = options.onError
    this.appContext = options.appContext ?? { version: 'unknown', platform: 'unknown' }
```

In `onReady()`, extend the `catch` block to emit the report (the connect-failure path in `start()` already does NOT call `onError`, so leave it untouched):

```ts
  private async onReady(): Promise<void> {
    try {
      await this.setupSession()
    } catch (err) {
      console.error('[sitcord] setupSession failed:', err)
      this.status = 'disconnected'
      this.statusDetail = err instanceof Error ? err.message : String(err)
      this.onError?.(
        buildErrorReport(
          err,
          'connection',
          { ...this.appContext, phase: 'setup' },
          this.now(),
          randomUUID()
        )
      )
      this.pushState()
    } finally {
      this.resolveFirstSetup?.()
      this.resolveFirstSetup = null
    }
  }
```

Leave `join()` and the other action methods unchanged — their rejections propagate to the IPC caller and are treated as recoverable (no report).

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npx vitest run src/main/service.test.ts`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 5: Type check, format check, commit**

```bash
npm run typecheck && npm run format:check
git add src/main/service.ts src/main/service.test.ts
git commit -m "feat: DiscordService emits connection ErrorReport on setup failure"
```

---

### Task 3: Report formatting and the `submitReport` stub

**Files:**
- Modify: `src/shared/error-report.ts`
- Modify: `src/shared/error-report.test.ts`
- Create: `src/main/submit-report.ts`

**Interfaces:**
- Consumes: `ErrorReport` (Task 1).
- Produces:
  - `formatReportText(report: ErrorReport): string` — full untruncated human-readable report.
  - `buildMailtoUrl(report: ErrorReport, maxBody?: number): string` — `mailto:bug@sitcord.com?subject=…&body=…`, body truncated to `maxBody` (default 1500) with a marker.
  - `submitReport(report: ErrorReport): Promise<void>` (in `src/main/submit-report.ts`) — copies the full report to the clipboard and opens the mailto URL via `shell.openExternal`.

- [ ] **Step 1: Write the failing tests** — append to `src/shared/error-report.test.ts`

```ts
import { formatReportText, buildMailtoUrl } from './error-report'

describe('formatReportText', () => {
  it('includes title, message, stack, version and platform', () => {
    const report = buildErrorReport(new Error('kaboom'), 'connection', ctx, 0, 'id')
    const text = formatReportText(report)

    expect(text).toContain("Couldn't connect to Discord")
    expect(text).toContain('kaboom')
    expect(text).toContain('0.1.3')
    expect(text).toContain('darwin')
    expect(text).toContain(report.stack as string)
  })
})

describe('buildMailtoUrl', () => {
  it('targets bug@sitcord.com with a url-encoded subject and body', () => {
    const report = buildErrorReport(new Error('kaboom'), 'connection', ctx, 0, 'id')
    const url = buildMailtoUrl(report)

    expect(url.startsWith('mailto:bug@sitcord.com?subject=')).toBe(true)
    expect(url).toContain('&body=')
    expect(decodeURIComponent(url.split('&body=')[1])).toContain('kaboom')
  })

  it('truncates an over-long body and marks it', () => {
    const big = new Error('x'.repeat(5000))
    const report = buildErrorReport(big, 'unknown', ctx, 0, 'id')
    const url = buildMailtoUrl(report, 200)
    const body = decodeURIComponent(url.split('&body=')[1])

    expect(body).toContain('truncated; full report on your clipboard')
    expect(body.length).toBeLessThan(300)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/error-report.test.ts`
Expected: FAIL — `formatReportText`/`buildMailtoUrl` are not exported.

- [ ] **Step 3: Implement the formatting functions** — append to `src/shared/error-report.ts`

```ts
const SUBMIT_EMAIL = 'bug@sitcord.com'
const MAX_MAILTO_BODY = 1500

// Full, human-readable report. Used verbatim for the clipboard copy and as the
// source for the (possibly truncated) mail body. new Date(ms) is deterministic.
export function formatReportText(report: ErrorReport): string {
  return [
    'Sitcord error report',
    `Title: ${report.title}`,
    `Category: ${report.category}`,
    `Time: ${new Date(report.timestamp).toISOString()}`,
    `Version: ${report.context.version}`,
    `Platform: ${report.context.platform}`,
    '',
    'Message:',
    report.message,
    '',
    'Stack:',
    report.stack ?? '(none)',
    '',
    'Context:',
    JSON.stringify(report.context, null, 2)
  ].join('\n')
}

// mailto: with a prefilled subject + body. Bodies are length-limited in
// practice (Windows caps the command near ~2KB; some clients clip), so truncate
// and point at the clipboard fallback.
export function buildMailtoUrl(report: ErrorReport, maxBody = MAX_MAILTO_BODY): string {
  const full = formatReportText(report)
  const body =
    full.length > maxBody
      ? full.slice(0, maxBody) + '\n…(truncated; full report on your clipboard)'
      : full
  const subject = `Sitcord error: ${report.title}`
  return `mailto:${SUBMIT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/shared/error-report.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Implement the side-effecting stub** at `src/main/submit-report.ts`

```ts
import { clipboard, shell } from 'electron'
import type { ErrorReport } from '../shared/ipc'
import { buildMailtoUrl, formatReportText } from '../shared/error-report'

// SUBMISSION STUB — swappable destination.
// TODO(submission target): decide where reports go and replace the body below.
// Candidates: Discord webhook (POST), prefilled GitHub issue (openExternal),
// or a hosted collector. The IPC seam and callers don't change — only this body.
// For now: open the user's mail client to bug@sitcord.com prefilled, and copy
// the full untruncated report to the clipboard so nothing is lost if the mail
// client clips the body.
export async function submitReport(report: ErrorReport): Promise<void> {
  clipboard.writeText(formatReportText(report))
  await shell.openExternal(buildMailtoUrl(report))
}
```

- [ ] **Step 6: Type check, format check, commit**

```bash
npm run typecheck && npm run format:check
git add src/shared/error-report.ts src/shared/error-report.test.ts src/main/submit-report.ts
git commit -m "feat: report formatting helpers and mailto submitReport stub"
```

---

### Task 4: IPC plumbing — preload bridge and main-process wiring

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `submitReport` (Task 3); `DiscordService` `onError`/`appContext` options (Task 2); `IPC.ERROR_REPORT`, `IPC.ERROR_SUBMIT`, `ErrorReport` (Task 1).
- Produces: `window.api.onErrorReport(cb: (report: ErrorReport) => void)` and `window.api.submitErrorReport(report: ErrorReport): Promise<void>`. Main pushes reports through a `sendError()` funnel (destroyed-window guard + caching + replay).

- [ ] **Step 1: Extend the preload bridge** in `src/preload/index.ts`

Update the import to add `ErrorReport`:

```ts
import { IPC, type AppState, type UpdateStatus, type ErrorReport } from '../shared/ipc'
```

Add these two methods to the `api` object (after `onUpdateStatus`, keeping the no-semicolon style):

```ts
  onErrorReport(callback: (report: ErrorReport) => void): void {
    ipcRenderer.on(IPC.ERROR_REPORT, (_event, report: ErrorReport) => callback(report))
  },
  submitErrorReport(report: ErrorReport): Promise<void> {
    return ipcRenderer.invoke(IPC.ERROR_SUBMIT, report)
  },
```

- [ ] **Step 2: Wire the main process** in `src/main/index.ts`

Update the shared-ipc import to add `ErrorReport`:

```ts
import { IPC, type AppState, type UpdateStatus, type ErrorReport } from '../shared/ipc'
```

Add the submit-report import (after the `initUpdater` import):

```ts
import { submitReport } from './submit-report'
```

Add a cached-report module variable next to `lastUpdateStatus`:

```ts
// Last critical error pushed, replayed to a freshly (re)opened window so a
// reopened window can still show/submit it.
let lastErrorReport: ErrorReport | null = null
```

Add a `sendError()` funnel next to `sendUpdateStatus()`:

```ts
// Same destroyed-window guard + caching for critical error reports.
function sendError(report: ErrorReport): void {
  lastErrorReport = report
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ERROR_REPORT, report)
  }
}
```

In `createWindow`, in the `did-finish-load` handler, replay the cached report too:

```ts
  win.webContents.on('did-finish-load', () => {
    if (lastState) win.webContents.send(IPC.STATE_UPDATE, lastState)
    if (lastUpdateStatus) win.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus)
    if (lastErrorReport) win.webContents.send(IPC.ERROR_REPORT, lastErrorReport)
  })
```

In `startService`, pass `onError` and `appContext` to the service constructor (alongside `onStateUpdate: sendState`):

```ts
    onStateUpdate: sendState,
    onError: sendError,
    appContext: { version: app.getVersion(), platform: process.platform }
```

And register the submit handler alongside the other `ipcMain.handle` calls:

```ts
  ipcMain.handle(IPC.ERROR_SUBMIT, (_event, report: ErrorReport) => submitReport(report))
```

- [ ] **Step 3: Type check and lint**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: PASS, no errors. (`window.api` gains the new methods automatically via `Api = typeof api`.)

- [ ] **Step 4: Build to confirm the bundles compile**

Run: `npm run build`
Expected: electron-vite builds main, preload, and renderer with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/main/index.ts
git commit -m "feat: wire ERROR_REPORT push and ERROR_SUBMIT handler through IPC"
```

---

### Task 5: Renderer error drawer (display + receive)

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.api.onErrorReport`, `window.api.submitErrorReport` (Task 4); `ErrorReport` (Task 1); existing `glyphsFor`, `detectConnectedController`, `makeChip`.
- Produces: `showError(report)`, `closeError()` and a `renderErrorDrawer()` that the render path appends; input handling that makes the drawer the top modal layer. Used by Task 6.

- [ ] **Step 1: Import the type and add drawer state** in `src/renderer/main.ts`

Update the shared-ipc import:

```ts
import type { AppState, UpdateStatus, ErrorReport } from '../shared/ipc'
```

Add state variables near the other module-level `let`s (e.g. after `let helpOpen = false`):

```ts
// Latest critical error shown in the error drawer (latest-only: a new report
// replaces any current one). null when there's nothing to show.
let currentError: ErrorReport | null = null
let errorOpen = false
```

- [ ] **Step 2: Add `renderErrorDrawer`, `showError`, `closeError`, `submitCurrentError`**

Add these functions (place them near `renderHelpDrawer`):

```ts
// The critical-error drawer. Structurally mirrors the help drawer: a
// bottom-anchored panel over a dim backdrop, animated via the `.open` class.
// Shows the latest error only, with Submit / Dismiss controller actions.
function renderErrorDrawer(): HTMLElement {
  const backdrop = document.createElement('div')
  backdrop.className = 'error-backdrop'
  if (errorOpen) backdrop.classList.add('open')
  backdrop.addEventListener('click', () => closeError())

  const panel = document.createElement('div')
  panel.className = 'error-panel'
  panel.addEventListener('click', (event) => event.stopPropagation())

  if (currentError) {
    const title = document.createElement('div')
    title.className = 'error-title'
    title.textContent = currentError.title
    panel.appendChild(title)

    const message = document.createElement('div')
    message.className = 'error-message'
    message.textContent = currentError.message
    panel.appendChild(message)

    const details = document.createElement('details')
    details.className = 'error-details'
    const summary = document.createElement('summary')
    summary.textContent = 'Details'
    const pre = document.createElement('pre')
    pre.textContent = [currentError.stack ?? '(no stack)', '', JSON.stringify(currentError.context, null, 2)].join('\n')
    details.append(summary, pre)
    panel.appendChild(details)

    const actions = document.createElement('div')
    actions.className = 'error-actions'
    const g = glyphsFor(detectConnectedController())
    const submitBtn = makeChip({ icon: g.a, label: 'Submit' }, 'error-action-label')
    submitBtn.className = 'error-action'
    submitBtn.addEventListener('click', () => submitCurrentError())
    const dismissBtn = makeChip({ icon: g.b, label: 'Dismiss' }, 'error-action-label')
    dismissBtn.className = 'error-action'
    dismissBtn.addEventListener('click', () => closeError())
    actions.append(submitBtn, dismissBtn)
    panel.appendChild(actions)
  }

  backdrop.appendChild(panel)
  return backdrop
}

// Replace any current error with this one and slide the drawer up. Rebuilds the
// drawer element (its contents depend on the report) and adds `.open` on the
// next frame so the CSS transition plays.
function showError(report: ErrorReport): void {
  currentError = report
  errorOpen = true
  const content = document.querySelector('.content')
  document.querySelector('.error-backdrop')?.remove()
  const drawer = renderErrorDrawer()
  drawer.classList.remove('open')
  content?.appendChild(drawer)
  requestAnimationFrame(() => drawer.classList.add('open'))
}

function closeError(): void {
  errorOpen = false
  currentError = null
  const backdrop = document.querySelector('.error-backdrop')
  if (backdrop) backdrop.classList.remove('open')
}

function submitCurrentError(): void {
  if (currentError) void window.api.submitErrorReport(currentError).catch(() => {})
  closeError()
}
```

- [ ] **Step 3: Append the drawer in both render branches** in `render()`

In the menu-mode branch, after `content.appendChild(renderHelpDrawer('menu'))`, add:

```ts
    content.appendChild(renderErrorDrawer())
```

In the channel-list branch, after `content.appendChild(renderHelpDrawer('channels'))`, add:

```ts
  content.appendChild(renderErrorDrawer())
```

- [ ] **Step 4: Make the drawer the top modal layer in `handleAction`**

At the very top of `handleAction(action)` (before the `reorderingGuildId` block), add:

```ts
  // The error drawer is the top modal layer: while open, A submits the report,
  // B/Esc dismisses, and everything else is swallowed.
  if (errorOpen) {
    if (action.type === 'join') submitCurrentError()
    else if (action.type === 'disconnect') closeError()
    return
  }
```

- [ ] **Step 5: Receive pushed reports from main**

Add near the other `window.api.on…` handlers (e.g. after the `onUpdateStatus` handler):

```ts
window.api.onErrorReport((report) => showError(report))
```

- [ ] **Step 6: Add the drawer styles** — append to `src/renderer/styles.css`

```css
.error-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.error-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.error-panel {
  background: var(--bg-alt);
  border-top: 2px solid var(--danger);
  border-top-left-radius: 0.6rem;
  border-top-right-radius: 0.6rem;
  box-shadow: 0 -0.4rem 1rem rgba(0, 0, 0, 0.4);
  max-height: 85%;
  overflow-y: auto;
  padding: 0.7rem 0.9rem 0.9rem;
  transform: translateY(100%);
  transition: transform 0.16s ease-out;
}

.error-backdrop.open .error-panel {
  transform: translateY(0);
}

.error-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--danger);
  margin-bottom: 0.4rem;
}

.error-message {
  font-size: 0.62rem;
  color: var(--fg);
  margin-bottom: 0.5rem;
  word-break: break-word;
}

.error-details {
  font-size: 0.52rem;
  color: var(--fg-muted);
  margin-bottom: 0.6rem;
}

.error-details summary {
  cursor: pointer;
}

.error-details pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 0.3rem;
  max-height: 30vh;
  overflow-y: auto;
}

.error-actions {
  display: flex;
  gap: 0.6rem;
}

.error-action {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.error-action-label {
  font-size: 0.62rem;
  color: var(--fg);
}
```

- [ ] **Step 7: Type check, lint, build**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run build`
Expected: PASS, no errors.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`. With Discord closed, the app sits on the "Can't reach Discord" menu (the drawer must **not** appear — that's the recoverable path). The drawer's wiring is exercised end-to-end in Task 6; this step confirms the build runs and the menu is unaffected.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/main.ts src/renderer/styles.css
git commit -m "feat: renderer critical-error drawer (display + receive)"
```

---

### Task 6: Renderer-local error capture (gamepad loop + uncaught UI errors)

**Files:**
- Modify: `src/renderer/gamepad.ts`
- Modify: `src/renderer/main.ts`

**Interfaces:**
- Consumes: `showError` (Task 5); `buildErrorReport` (Task 1); existing `startGamepadLoop`, `startKeyboardFallback`.
- Produces: `startGamepadLoop`/`startKeyboardFallback` gain an optional `onError?: (err: unknown) => void` param; `main.ts` reports gamepad-loop and uncaught UI crashes into the drawer and logs (without surfacing) recoverable promise rejections.

- [ ] **Step 1: Add an `onError` param to the gamepad loop** in `src/renderer/gamepad.ts`

Change the `startGamepadLoop` signature:

```ts
export function startGamepadLoop(onAction: InputHandler, onError?: (err: unknown) => void): () => void {
```

Wrap the body of the inner `poll()` function so a throw stops the loop and reports it (the loop is already dead once it throws — do not reschedule):

```ts
  function poll(): void {
    if (stopped) return

    try {
      const now = performance.now()
      for (const gamepad of navigator.getGamepads()) {
        if (!gamepad) continue

        fireOnPress(gamepad, BUTTON_DPAD_UP, { type: 'nav', action: 'UP' })
        fireOnPress(gamepad, BUTTON_DPAD_DOWN, { type: 'nav', action: 'DOWN' })
        pollBumper(gamepad, now, BUTTON_LEFT_BUMPER, 'input', 'GROUP_PREV')
        pollBumper(gamepad, now, BUTTON_RIGHT_BUMPER, 'output', 'GROUP_NEXT')
        fireTapOrHold(gamepad, BUTTON_A, now, { type: 'join' }, { type: 'pickup' })
        fireOnPress(gamepad, BUTTON_B, { type: 'disconnect' })
        fireOnPress(gamepad, BUTTON_X, { type: 'toggleMute' })
        fireOnPress(gamepad, BUTTON_Y, { type: 'toggleDeafen' })
        fireOnPress(gamepad, BUTTON_LEFT_TRIGGER, { type: 'zoom', direction: 'out' })
        fireOnPress(gamepad, BUTTON_RIGHT_TRIGGER, { type: 'zoom', direction: 'in' })
        fireOnPress(gamepad, BUTTON_START, { type: 'toggleFavorite' })
        fireOnPress(gamepad, BUTTON_SELECT, { type: 'toggleHelp' })

        const windowChord = pressed(gamepad, BUTTON_R3) && pressed(gamepad, BUTTON_LEFT_BUMPER)
        const windowChordKey = `${gamepad.index}:windowChord`
        if (windowChord && !wasPressed.get(windowChordKey)) onAction({ type: 'minimize' })
        wasPressed.set(windowChordKey, windowChord)
        if (windowChord) {
          const lbHold = bumperHold.get(`${gamepad.index}:${BUTTON_LEFT_BUMPER}`)
          if (lbHold) lbHold.consumed = true
        }

        pollStick(gamepad, now)
      }
    } catch (err) {
      // The rAF loop is dead once a frame throws; stop it and surface the crash
      // rather than spinning on the same error every frame.
      stopped = true
      onError?.(err)
      return
    }

    requestAnimationFrame(poll)
  }
```

(This replaces the existing `poll()` body — the only changes are the surrounding `try { … } catch { … }` and not rescheduling on throw. Keep the existing comments inside where practical.)

- [ ] **Step 2: Add an `onError` param to the keyboard fallback** in `src/renderer/gamepad.ts`

```ts
export function startKeyboardFallback(onAction: InputHandler, onError?: (err: unknown) => void): () => void {
  function handleKeydown(event: KeyboardEvent): void {
    const action = KEY_ACTIONS[event.key]
    if (!action) return
    event.preventDefault()
    try {
      onAction(action)
    } catch (err) {
      onError?.(err)
    }
  }

  window.addEventListener('keydown', handleKeydown)
  return () => window.removeEventListener('keydown', handleKeydown)
}
```

- [ ] **Step 3: Wire local capture in `src/renderer/main.ts`**

Add the import:

```ts
import { buildErrorReport } from '../shared/error-report'
```

Add a renderer-context helper and a local-report helper (near `showError`):

```ts
// Context for a renderer-originated report. version comes from the update
// status push (may be '' before it arrives); platform from the user agent.
function rendererContext(): ErrorReport['context'] {
  return { version: updateStatus.version || 'unknown', platform: navigator.userAgent }
}

function reportLocalError(err: unknown, category: ErrorReport['category']): void {
  showError(buildErrorReport(err, category, rendererContext(), Date.now(), crypto.randomUUID()))
}
```

Replace the existing loop-start calls:

```ts
startGamepadLoop(handleAction)
startKeyboardFallback(handleAction)
```

with:

```ts
startGamepadLoop(handleAction, (err) => reportLocalError(err, 'controller'))
startKeyboardFallback(handleAction, (err) => reportLocalError(err, 'controller'))

// Uncaught UI exceptions are real crashes → surface them. Recoverable promise
// rejections (e.g. a single rejected voice command) are logged, never surfaced
// (per the critical-only rule): swallow them so they don't become noise.
window.addEventListener('error', (event) => reportLocalError(event.error ?? event.message, 'unknown'))
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  console.warn('Recoverable rejection (not surfaced):', event.reason)
})
```

- [ ] **Step 4: Type check, lint, build**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run build`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (no renderer regressions; the gamepad change is additive).

- [ ] **Step 6: Manual smoke test (the real end-to-end check)**

Run: `npm run dev`, then verify:
1. **Connection error surfaces:** temporarily force a failure — in `src/main/service.ts` `setupSession`, add `throw new Error('forced test')` as the first line, relaunch with Discord running. The error drawer should slide up with title "Couldn't connect to Discord", message "forced test", a Details disclosure with the stack, and Submit/Dismiss. **Revert the throw after.**
2. **Submit:** press Enter (or click Submit) — your mail client opens composing to `bug@sitcord.com` with the report prefilled, and the full report is on your clipboard.
3. **Dismiss:** Esc/B (or click the backdrop) closes the drawer.
4. **No false positives:** with Discord closed, only the "Can't reach Discord" menu shows — no drawer.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/gamepad.ts src/renderer/main.ts
git commit -m "feat: capture gamepad-loop and uncaught UI errors into the error drawer"
```

---

## Self-Review

**Spec coverage:**
- Consolidated channel from both processes → Tasks 2 (main emit), 4 (push), 5/6 (renderer receive + local capture). ✓
- Critical-only taxonomy (connection/controller/unknown; exclusions) → Task 2 tests assert connect-failure and recoverable-command don't report; Task 6 excludes `unhandledrejection` from the drawer. ✓
- Help-drawer-style panel, latest-only, auto-open, A/B actions, top modal layer → Task 5. ✓
- `buildErrorReport` pure + tested → Task 1. ✓
- mailto + clipboard stub, swappable, `bug@sitcord.com`, truncation → Task 3. ✓
- `statusDetail` inline menu hint untouched → confirmed (Task 2 leaves it; Task 5 doesn't touch the menu hint). ✓
- TDD targets (`buildErrorReport`, service assertions) → Tasks 1, 2. ✓

**Placeholder scan:** No TBD/TODO in requirements. The one `TODO(submission target)` is intentional product scope (the deferred destination) and is shown in full. No "similar to Task N" — code is repeated where needed.

**Type consistency:** `ErrorReport` shape, `category` union (`connection | controller | unknown`), `buildErrorReport(err, category, context, now, id)`, `formatReportText(report)`, `buildMailtoUrl(report, maxBody?)`, `submitReport(report)`, `onErrorReport`/`submitErrorReport`, `showError`/`closeError`/`submitCurrentError`/`renderErrorDrawer` — names and signatures match across all tasks. Service options `onError?`/`appContext?` are optional, so each task's `typecheck` stays green before Task 4 wires them.
