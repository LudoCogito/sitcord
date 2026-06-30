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
