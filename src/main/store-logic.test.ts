import { describe, it, expect } from 'vitest'
import { recordJoin, toggleFavorite } from './store-logic'
import type { Store } from './ranking'

const empty: Store = { favorites: [], usage: {} }

describe('recordJoin', () => {
  it('increments count and sets lastJoined', () => {
    const s = recordJoin(empty, 'a', 123)
    expect(s.usage.a).toEqual({ count: 1, lastJoined: 123 })
    const s2 = recordJoin(s, 'a', 200)
    expect(s2.usage.a).toEqual({ count: 2, lastJoined: 200 })
  })
  it('does not mutate the input', () => {
    recordJoin(empty, 'a', 1); expect(empty.usage.a).toBeUndefined()
  })
})

describe('toggleFavorite', () => {
  it('adds when absent and removes when present', () => {
    const s = toggleFavorite(empty, 'a'); expect(s.favorites).toEqual(['a'])
    expect(toggleFavorite(s, 'a').favorites).toEqual([])
  })
})
