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
  deafened: false
}

describe('buildView', () => {
  it('emits a header row followed by its channel rows, per group', () => {
    const rows = buildView(state, 0)
    expect(rows.map((r) => r.kind)).toEqual(['header', 'channel', 'channel', 'header', 'channel'])
    expect(rows[0]).toMatchObject({ kind: 'header', guildId: 'g1', guildName: 'Guild One' })
    expect(rows[3]).toMatchObject({ kind: 'header', guildId: 'g2', guildName: 'Guild Two' })
  })

  it('marks favorites, the current channel, and occupancy counts', () => {
    const rows = buildView(state, 0)
    const c1 = rows[1]
    const c2 = rows[2]
    const c3 = rows[4]

    expect(c1).toMatchObject({ kind: 'channel', channelId: 'c1', occupancy: 2, isFavorite: false, isCurrent: false })
    expect(c2).toMatchObject({ kind: 'channel', channelId: 'c2', occupancy: 0, isFavorite: true, isCurrent: false })
    expect(c3).toMatchObject({ kind: 'channel', channelId: 'c3', occupancy: 1, isFavorite: false, isCurrent: true })
  })

  it('marks the channel at selectionIndex as selected, skipping headers when indexing', () => {
    expect(buildView(state, 0).filter((r) => r.kind === 'channel').map((r) => r.isSelected)).toEqual([
      true,
      false,
      false
    ])

    expect(buildView(state, 2).filter((r) => r.kind === 'channel').map((r) => r.isSelected)).toEqual([
      false,
      false,
      true
    ])
  })
})
