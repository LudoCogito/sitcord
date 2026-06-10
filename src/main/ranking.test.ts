import { describe, it, expect } from 'vitest'
import { rankChannels, type VoiceChannel, type Store } from './ranking'

const ch = (id: string, guildId: string, guildName: string, name: string): VoiceChannel =>
  ({ id, guildId, guildName, name })

describe('rankChannels', () => {
  it('groups by server and pins favorites in manual order, then usage desc', () => {
    const channels = [
      ch('a', 'g1', 'Server One', 'General'),
      ch('b', 'g1', 'Server One', 'Gaming'),
      ch('c', 'g1', 'Server One', 'Music'),
    ]
    const store: Store = {
      favorites: ['c'],
      usage: { a: { count: 5, lastJoined: 100 }, b: { count: 10, lastJoined: 50 } },
    }
    const groups = rankChannels(channels, store)
    expect(groups.length).toBe(1)
    expect(groups[0].guildName).toBe('Server One')
    expect(groups[0].channels.map(c => c.id)).toEqual(['c', 'b', 'a']) // fav, then count 10, then 5
  })
  it('breaks usage ties by recency (lastJoined desc)', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: [], usage: { a:{count:3,lastJoined:1}, b:{count:3,lastJoined:9} } }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
  it('orders multiple favorites by their position in the favorites array', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: ['b','a'], usage: {} }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
  it('places unused non-favorite channels last (count 0)', () => {
    const channels = [ch('a','g1','S','A'), ch('b','g1','S','B')]
    const store: Store = { favorites: [], usage: { b:{count:1,lastJoined:1} } }
    expect(rankChannels(channels, store)[0].channels.map(c=>c.id)).toEqual(['b','a'])
  })
})
