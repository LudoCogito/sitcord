export interface VoiceChannel {
  id: string
  guildId: string
  guildName: string
  guildIconUrl?: string
  name: string
}

export interface UsageEntry {
  count: number
  lastJoined: number
}

export interface Store {
  favorites: string[]
  usage: Record<string, UsageEntry>
}

export interface ServerGroup {
  guildId: string
  guildName: string
  iconUrl?: string
  channels: VoiceChannel[]
}

export function rankChannels(channels: VoiceChannel[], store: Store): ServerGroup[] {
  const byGuild = new Map<string, ServerGroup>()
  for (const c of channels) {
    if (!byGuild.has(c.guildId)) byGuild.set(c.guildId, { guildId: c.guildId, guildName: c.guildName, iconUrl: c.guildIconUrl, channels: [] })
    byGuild.get(c.guildId)!.channels.push(c)
  }
  const favRank = new Map(store.favorites.map((id, i) => [id, i]))
  for (const group of byGuild.values()) {
    group.channels.sort((a, b) => {
      const fa = favRank.has(a.id), fb = favRank.has(b.id)
      if (fa && fb) return favRank.get(a.id)! - favRank.get(b.id)!
      if (fa) return -1
      if (fb) return 1
      const ua = store.usage[a.id] ?? { count: 0, lastJoined: 0 }
      const ub = store.usage[b.id] ?? { count: 0, lastJoined: 0 }
      if (ub.count !== ua.count) return ub.count - ua.count
      return ub.lastJoined - ua.lastJoined
    })
  }
  return [...byGuild.values()]
}
