import type { Row } from './render'

export interface NavState {
  rows: Row[]
  selectionIndex: number
}

export type NavAction = 'UP' | 'DOWN' | 'GROUP_PREV' | 'GROUP_NEXT'

function channelCount(rows: Row[]): number {
  return rows.filter((row) => row.kind === 'channel').length
}

/** Channel-index (skipping headers) of the first channel in each group, in order. */
function groupStarts(rows: Row[]): number[] {
  const starts: number[] = []
  let channelIndex = 0
  let pendingHeader = false

  for (const row of rows) {
    if (row.kind === 'header') {
      pendingHeader = true
      continue
    }
    if (pendingHeader) {
      starts.push(channelIndex)
      pendingHeader = false
    }
    channelIndex++
  }

  return starts
}

export function navigate(state: NavState, action: NavAction): NavState {
  const count = channelCount(state.rows)
  if (count === 0) return state

  switch (action) {
    case 'UP':
      return { ...state, selectionIndex: Math.max(0, state.selectionIndex - 1) }
    case 'DOWN':
      return { ...state, selectionIndex: Math.min(count - 1, state.selectionIndex + 1) }
    case 'GROUP_PREV':
    case 'GROUP_NEXT': {
      const starts = groupStarts(state.rows)
      let currentGroup = 0
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= state.selectionIndex) currentGroup = i
        else break
      }
      const targetGroup = action === 'GROUP_NEXT' ? currentGroup + 1 : currentGroup - 1
      if (targetGroup < 0 || targetGroup >= starts.length) return state
      return { ...state, selectionIndex: starts[targetGroup] }
    }
  }
}
