import type { UpdateStatus } from '../shared/ipc'

export interface Indicator {
  // Text for the bottom-right corner: "v1.2.0" normally, "Update available"
  // when a newer release was detected, or "" before the version is known.
  text: string
  // True only when an update is available — the renderer turns the text yellow.
  available: boolean
}

// Pure mapping from update status to the bottom-right corner indicator. Shows
// the running version until electron-updater reports a newer one, at which point
// it switches to the highlighted "Update available" label.
export function updateIndicator(status: UpdateStatus): Indicator {
  if (status.updateAvailable) return { text: 'Update available', available: true }
  return { text: status.version ? `v${status.version}` : '', available: false }
}
