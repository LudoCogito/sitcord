import type { AppState } from '../shared/ipc'

export interface HeaderRow {
  kind: 'header'
  guildId: string
  guildName: string
  iconUrl?: string
  channelCount: number
  isCollapsed: boolean
  isSelected: boolean
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

/**
 * Flatten the grouped state into the rendered/navigable row list. Selection is
 * a single index over *all* rows — both server headers and channels are
 * landable, so a header can be selected to collapse/expand its group. Channels
 * of a collapsed group (`collapsed` holds its guildId) are omitted entirely, so
 * they drop out of both the DOM and navigation.
 */
export function buildView(
  state: AppState,
  selectionIndex: number,
  collapsed: Set<string> = new Set()
): Row[] {
  const rows: Row[] = []
  let rowIndex = 0

  for (const group of state.groups) {
    const isCollapsed = collapsed.has(group.guildId)
    rows.push({
      kind: 'header',
      guildId: group.guildId,
      guildName: group.guildName,
      iconUrl: group.iconUrl,
      channelCount: group.channels.length,
      isCollapsed,
      isSelected: rowIndex === selectionIndex
    })
    rowIndex++

    if (isCollapsed) continue

    for (const channel of group.channels) {
      rows.push({
        kind: 'channel',
        channelId: channel.id,
        guildId: group.guildId,
        name: channel.name,
        occupancy: state.occupancy[channel.id] ?? 0,
        isFavorite: state.favorites.includes(channel.id),
        isCurrent: state.currentChannelId === channel.id,
        isSelected: rowIndex === selectionIndex
      })
      rowIndex++
    }
  }

  return rows
}
