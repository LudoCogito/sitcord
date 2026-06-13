import type { Row } from './render'

export interface NavState {
  rows: Row[]
  selectionIndex: number
}

export type NavAction = 'UP' | 'DOWN' | 'GROUP_PREV' | 'GROUP_NEXT'

/** Row indices of the server headers, in order. */
function headerIndices(rows: Row[]): number[] {
  const indices: number[] = []
  rows.forEach((row, i) => {
    if (row.kind === 'header') indices.push(i)
  })
  return indices
}

/**
 * Pure selection reducer over the flat row list. UP/DOWN step one row at a time
 * (headers are landable, so you can select a server to collapse it). The
 * bumpers (GROUP_PREV/GROUP_NEXT) jump between server headers.
 */
export function navigate(state: NavState, action: NavAction): NavState {
  const count = state.rows.length
  if (count === 0) return state

  switch (action) {
    case 'UP':
      return { ...state, selectionIndex: Math.max(0, state.selectionIndex - 1) }
    case 'DOWN':
      return { ...state, selectionIndex: Math.min(count - 1, state.selectionIndex + 1) }
    case 'GROUP_PREV':
    case 'GROUP_NEXT': {
      const headers = headerIndices(state.rows)
      if (headers.length === 0) return state

      // The group we're in = the last header at or before the selection.
      let currentGroup = 0
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] <= state.selectionIndex) currentGroup = i
        else break
      }
      const targetGroup = action === 'GROUP_NEXT' ? currentGroup + 1 : currentGroup - 1
      if (targetGroup < 0 || targetGroup >= headers.length) return state
      return { ...state, selectionIndex: headers[targetGroup] }
    }
  }
}
