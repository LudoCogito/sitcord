import { describe, it, expect } from 'vitest'
import { buildView } from './render'
import type { AppState } from '../shared/ipc'

const state: AppState = {
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
    }
  ],
  currentChannelId: 'c3',
  occupancy: { c1: 2, c2: 0, c3: 1 },
  favorites: ['c2'],
  muted: false,
  deafened: false,
  inputVolume: 100,
  outputVolume: 100
}

describe('buildView', () => {
  it('emits a header row followed by its channel rows, per group', () => {
    const rows = buildView(state, 0)
    expect(rows.map((r) => r.kind)).toEqual(['header', 'channel', 'channel', 'header', 'channel'])
    expect(rows[0]).toMatchObject({
      kind: 'header',
      guildId: 'g1',
      guildName: 'Guild One',
      isCollapsed: false,
      channelCount: 2
    })
    expect(rows[3]).toMatchObject({ kind: 'header', guildId: 'g2', channelCount: 1 })
  })

  it('marks favorites, the current channel, and occupancy counts', () => {
    const rows = buildView(state, 0)
    expect(rows[1]).toMatchObject({ kind: 'channel', channelId: 'c1', occupancy: 2, isFavorite: false, isCurrent: false })
    expect(rows[2]).toMatchObject({ kind: 'channel', channelId: 'c2', occupancy: 0, isFavorite: true, isCurrent: false })
    expect(rows[4]).toMatchObject({ kind: 'channel', channelId: 'c3', occupancy: 1, isFavorite: false, isCurrent: true })
  })

  it('marks the row at selectionIndex as selected (headers are selectable too)', () => {
    expect(buildView(state, 0).map((r) => r.isSelected)).toEqual([true, false, false, false, false])
    expect(buildView(state, 1).map((r) => r.isSelected)).toEqual([false, true, false, false, false])
    expect(buildView(state, 3).map((r) => r.isSelected)).toEqual([false, false, false, true, false])
  })

  it('omits a collapsed group’s channel rows but keeps (and flags) its header', () => {
    const rows = buildView(state, 0, new Set(['g1']))
    expect(rows.map((r) => r.kind)).toEqual(['header', 'header', 'channel'])
    expect(rows[0]).toMatchObject({ kind: 'header', guildId: 'g1', isCollapsed: true, channelCount: 2 })
    expect(rows[1]).toMatchObject({ kind: 'header', guildId: 'g2', isCollapsed: false })
  })
})
