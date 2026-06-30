import type { ErrorReport } from './ipc'

// Human-readable headline per category, shown at the top of the error drawer.
const TITLES: Record<ErrorReport['category'], string> = {
  connection: "Couldn't connect to Discord",
  controller: 'Controller input stopped',
  unknown: 'Something went wrong'
}

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
  let truncated = full.length > maxBody ? full.slice(0, maxBody) : full
  // Drop a trailing lone high surrogate left by slicing mid-astral-char so
  // encodeURIComponent doesn't throw URIError.
  if (
    truncated.charCodeAt(truncated.length - 1) >= 0xd800 &&
    truncated.charCodeAt(truncated.length - 1) <= 0xdbff
  ) {
    truncated = truncated.slice(0, -1)
  }
  const body =
    full.length > maxBody ? truncated + '\n…(truncated; full report on your clipboard)' : full
  const subject = `Sitcord error: ${report.title}`
  return `mailto:${SUBMIT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
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
