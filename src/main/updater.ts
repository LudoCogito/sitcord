import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

// Thin side-effecting wrapper around electron-updater (like rpc-client.ts /
// store.ts). The corner indicator in the renderer is driven entirely by the
// UpdateStatus values pushed through `send`.
//
// electron-updater only does real work in a packaged build with a configured
// `build.publish` provider; in dev, with no provider, or offline, the check
// rejects — we swallow that and stay on the version-only indicator. The version
// itself always comes straight from app.getVersion(), so the corner shows it
// regardless.
export function initUpdater(send: (status: UpdateStatus) => void): void {
  const version = app.getVersion()

  // Baseline immediately so the corner shows the current version on launch.
  send({ version, updateAvailable: false })

  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true

  // Both events flip the corner to the highlighted "Update available" — we only
  // surface that a newer build exists, not download progress.
  autoUpdater.on('update-available', () => send({ version, updateAvailable: true }))
  autoUpdater.on('update-downloaded', () => send({ version, updateAvailable: true }))
  autoUpdater.on('error', (err) => console.warn('Update check error:', err?.message ?? err))

  // checkForUpdates throws when not packaged / no provider; never let that crash
  // startup — the indicator just stays version-only.
  try {
    void autoUpdater.checkForUpdates()?.catch((err) => {
      console.warn('Update check skipped:', err?.message ?? err)
    })
  } catch (err) {
    console.warn('Update check unavailable:', (err as Error)?.message ?? err)
  }
}
