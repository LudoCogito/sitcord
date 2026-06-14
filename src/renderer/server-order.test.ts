import { describe, it, expect } from 'vitest'
import { orderGroups, moveGuild, moveGuildRelativeTo } from './server-order'

const g = (guildId: string) => ({ guildId })

describe('orderGroups', () => {
  it('sorts groups to match the saved order', () => {
    const groups = [g('a'), g('b'), g('c')]
    expect(orderGroups(groups, ['c', 'a', 'b']).map((x) => x.guildId)).toEqual(['c', 'a', 'b'])
  })

  it('keeps unknown guilds after ordered ones, in their incoming order', () => {
    const groups = [g('a'), g('b'), g('c'), g('d')]
    // Only b and d are explicitly ordered; a and c are unknown and trail along.
    expect(orderGroups(groups, ['d', 'b']).map((x) => x.guildId)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('ignores stale ids in the order that are no longer present', () => {
    const groups = [g('a'), g('b')]
    expect(orderGroups(groups, ['gone', 'b', 'a']).map((x) => x.guildId)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const groups = [g('a'), g('b')]
    orderGroups(groups, ['b', 'a'])
    expect(groups.map((x) => x.guildId)).toEqual(['a', 'b'])
  })
})

describe('moveGuild', () => {
  it('moves a guild up', () => {
    expect(moveGuild(['a', 'b', 'c'], 'b', 'UP')).toEqual(['b', 'a', 'c'])
  })

  it('moves a guild down', () => {
    expect(moveGuild(['a', 'b', 'c'], 'b', 'DOWN')).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op at the top edge', () => {
    expect(moveGuild(['a', 'b', 'c'], 'a', 'UP')).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op at the bottom edge', () => {
    expect(moveGuild(['a', 'b', 'c'], 'c', 'DOWN')).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op for an unknown guild', () => {
    expect(moveGuild(['a', 'b'], 'z', 'UP')).toEqual(['a', 'b'])
  })
})

describe('moveGuildRelativeTo', () => {
  it('drops a guild before a target', () => {
    expect(moveGuildRelativeTo(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual([
      'a',
      'd',
      'b',
      'c'
    ])
  })

  it('drops a guild after a target', () => {
    expect(moveGuildRelativeTo(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
  })

  it('handles dragging downward without an off-by-one', () => {
    // Move the first item to just after the second: a should land between b and c.
    expect(moveGuildRelativeTo(['a', 'b', 'c'], 'a', 'b', 'after')).toEqual(['b', 'a', 'c'])
  })

  it('is a no-op when dropping a guild onto itself', () => {
    expect(moveGuildRelativeTo(['a', 'b', 'c'], 'b', 'b', 'before')).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op when either id is missing', () => {
    expect(moveGuildRelativeTo(['a', 'b'], 'z', 'a', 'before')).toEqual(['a', 'b'])
    expect(moveGuildRelativeTo(['a', 'b'], 'a', 'z', 'before')).toEqual(['a', 'b'])
  })
})
