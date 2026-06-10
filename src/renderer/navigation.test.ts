import { describe, it, expect } from 'vitest'
import { navigate, type NavState } from './navigation'
import { buildView } from './render'
import type { AppState } from '../shared/ipc'

const appState: AppState = {
  status: 'connected',
  groups: [
    {
      guildId: 'g1',
      guildName: 'Guild One',
      channels: [
        { id: 'c1', guildId: 'g1', guildName: 'Guild One', name: 'General' },
        { id: 'c2', guildId: 'g1', guildName: 'Guild One', name: 'AFK' }
      ]
    },
    {
      guildId: 'g2',
      guildName: 'Guild Two',
      channels: [{ id: 'c3', guildId: 'g2', guildName: 'Guild Two', name: 'Lounge' }]
    },
    {
      guildId: 'g3',
      guildName: 'Guild Three',
      channels: [
        { id: 'c4', guildId: 'g3', guildName: 'Guild Three', name: 'Raid' },
        { id: 'c5', guildId: 'g3', guildName: 'Guild Three', name: 'Chill' }
      ]
    }
  ],
  currentChannelId: null,
  occupancy: {},
  favorites: [],
  muted: false,
  deafened: false
}

const rows = buildView(appState, 0)

function state(selectionIndex: number): NavState {
  return { rows, selectionIndex }
}

describe('navigate', () => {
  it('moves selection down and up across channel rows, skipping headers', () => {
    expect(navigate(state(0), 'DOWN').selectionIndex).toBe(1)
    expect(navigate(state(1), 'DOWN').selectionIndex).toBe(2)
    expect(navigate(state(2), 'UP').selectionIndex).toBe(1)
  })

  it('clamps UP/DOWN at the ends', () => {
    expect(navigate(state(0), 'UP').selectionIndex).toBe(0)
    expect(navigate(state(4), 'DOWN').selectionIndex).toBe(4)
  })

  it('GROUP_NEXT jumps to the first channel of the next group', () => {
    expect(navigate(state(0), 'GROUP_NEXT').selectionIndex).toBe(2)
    expect(navigate(state(1), 'GROUP_NEXT').selectionIndex).toBe(2)
    expect(navigate(state(2), 'GROUP_NEXT').selectionIndex).toBe(3)
  })

  it('GROUP_PREV jumps to the first channel of the previous group', () => {
    expect(navigate(state(4), 'GROUP_PREV').selectionIndex).toBe(2)
    expect(navigate(state(3), 'GROUP_PREV').selectionIndex).toBe(2)
    expect(navigate(state(2), 'GROUP_PREV').selectionIndex).toBe(0)
  })

  it('clamps GROUP_NEXT/GROUP_PREV at the first/last group', () => {
    expect(navigate(state(3), 'GROUP_NEXT').selectionIndex).toBe(3)
    expect(navigate(state(0), 'GROUP_PREV').selectionIndex).toBe(0)
  })

  it('is a no-op when there are no channels', () => {
    const empty: NavState = { rows: [], selectionIndex: 0 }
    expect(navigate(empty, 'DOWN').selectionIndex).toBe(0)
    expect(navigate(empty, 'GROUP_NEXT').selectionIndex).toBe(0)
  })
})
