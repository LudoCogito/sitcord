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
