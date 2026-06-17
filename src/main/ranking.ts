import type { VoiceChannel, Store, ServerGroup } from '../shared/voice'

// The voice data shapes now live in `shared/voice` (so the renderer doesn't
// depend on this main-side module). Re-exported here for the main-side callers
// that already import them from `./ranking`.
export type { VoiceChannel, UsageEntry, Store, ServerGroup } from '../shared/voice'

export function rankChannels(channels: VoiceChannel[], store: Store): ServerGroup[] {
  const byGuild = new Map<string, ServerGroup>()
  for (const c of channels) {
    if (!byGuild.has(c.guildId))
      byGuild.set(c.guildId, {
        guildId: c.guildId,
        guildName: c.guildName,
        iconUrl: c.guildIconUrl,
        channels: []
      })
    byGuild.get(c.guildId)!.channels.push(c)
  }
  const favRank = new Map(store.favorites.map((id, i) => [id, i]))
  for (const group of byGuild.values()) {
    group.channels.sort((a, b) => {
      const fa = favRank.has(a.id),
        fb = favRank.has(b.id)
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
