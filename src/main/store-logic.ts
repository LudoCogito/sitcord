import type { Store } from './ranking'

export function recordJoin(store: Store, channelId: string, now: number): Store {
  const prev = store.usage[channelId] ?? { count: 0, lastJoined: 0 }
  return { ...store, usage: { ...store.usage, [channelId]: { count: prev.count + 1, lastJoined: now } } }
}

export function toggleFavorite(store: Store, channelId: string): Store {
  const has = store.favorites.includes(channelId)
  return { ...store, favorites: has ? store.favorites.filter(id => id !== channelId) : [...store.favorites, channelId] }
}
