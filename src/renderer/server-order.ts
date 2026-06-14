// Manual server (guild) ordering, applied renderer-side over whatever group
// list the main process pushes — the same approach as collapse state and zoom,
// so it survives reconnects with no main-process plumbing. Kept as pure
// functions (no DOM, no storage) so the ordering rules are unit-testable.

/**
 * Order groups by a saved guildId order. Guilds not in `order` keep their
 * incoming relative order and fall after the explicitly-ordered ones, so a
 * freshly-joined server simply shows up at the bottom until the user moves it.
 * Array.sort is stable, so equal-rank items (two unknowns) hold their order.
 */
export function orderGroups<T extends { guildId: string }>(groups: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  const rankOf = (id: string): number => rank.get(id) ?? Number.POSITIVE_INFINITY
  return [...groups].sort((a, b) => rankOf(a.guildId) - rankOf(b.guildId))
}

/**
 * Move one guild up or down a slot within the given (already-displayed) order,
 * returning the new full order to persist. A no-op (returns the same array) when
 * the guild is missing or already at the relevant edge.
 */
export function moveGuild(order: string[], guildId: string, direction: 'UP' | 'DOWN'): string[] {
  const i = order.indexOf(guildId)
  if (i === -1) return order
  const j = direction === 'UP' ? i - 1 : i + 1
  if (j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * Move `guildId` so it lands immediately before/after `targetGuildId` — the
 * primitive behind mouse drag-and-drop, where a server can be dropped anywhere
 * rather than nudged one slot. A no-op when either id is missing or they're the
 * same. The guild is removed first, so the target's index is taken *after*
 * removal (no off-by-one when dragging downward).
 */
export function moveGuildRelativeTo(
  order: string[],
  guildId: string,
  targetGuildId: string,
  position: 'before' | 'after'
): string[] {
  if (guildId === targetGuildId || !order.includes(guildId)) return order
  const without = order.filter((id) => id !== guildId)
  const ti = without.indexOf(targetGuildId)
  if (ti === -1) return order
  without.splice(position === 'before' ? ti : ti + 1, 0, guildId)
  return without
}
