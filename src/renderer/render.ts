import type { AppState } from '../shared/ipc'

export interface HeaderRow {
  kind: 'header'
  guildId: string
  guildName: string
}

export interface ChannelRow {
  kind: 'channel'
  channelId: string
  guildId: string
  name: string
  occupancy: number
  isFavorite: boolean
  isCurrent: boolean
  isSelected: boolean
}

export type Row = HeaderRow | ChannelRow

export function buildView(state: AppState, selectionIndex: number): Row[] {
  const rows: Row[] = []
  let channelIndex = 0

  for (const group of state.groups) {
    rows.push({ kind: 'header', guildId: group.guildId, guildName: group.guildName })

    for (const channel of group.channels) {
      rows.push({
        kind: 'channel',
        channelId: channel.id,
        guildId: group.guildId,
        name: channel.name,
        occupancy: state.occupancy[channel.id] ?? 0,
        isFavorite: state.favorites.includes(channel.id),
        isCurrent: state.currentChannelId === channel.id,
        isSelected: channelIndex === selectionIndex
      })
      channelIndex++
    }
  }

  return rows
}
