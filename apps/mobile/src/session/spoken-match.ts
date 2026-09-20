/**
 * Finds the one item a recipient named out loud, or nothing.
 *
 * Names here are written by caretakers, so they cannot be matched against a
 * fixed phrase table the way traversal commands are. Matching widens in stages —
 * exact, then containment, then shared words — and stops at the first stage that
 * produces a single answer.
 *
 * Ambiguity returns null rather than a guess. Starting the wrong routine is a
 * worse outcome for a recipient than being asked which one they meant, and the
 * caller can narrow it down by listing the candidates back.
 */
export function matchByName<T>(
  items: readonly T[],
  spoken: string,
  nameOf: (item: T) => string,
): T | null {
  const target = normalize(spoken)
  if (!target) return null

  const candidates = items.map((item) => ({ item, name: normalize(nameOf(item)) }))

  const exact = candidates.filter((candidate) => candidate.name === target)
  if (exact.length > 0) return exact.length === 1 ? (exact[0]?.item ?? null) : null

  const contained = candidates.filter(
    (candidate) => candidate.name.includes(target) || target.includes(candidate.name),
  )
  if (contained.length > 0) return contained.length === 1 ? (contained[0]?.item ?? null) : null

  return bestBySharedWords(candidates, new Set(target.split(' ')))
}

function bestBySharedWords<T>(
  candidates: readonly { item: T; name: string }[],
  spokenWords: ReadonlySet<string>,
): T | null {
  const scored = candidates
    .map(({ item, name }) => ({
      item,
      shared: name.split(' ').filter((word) => spokenWords.has(word)).length,
    }))
    .filter((candidate) => candidate.shared > 0)
    .sort((left, right) => right.shared - left.shared)

  const best = scored[0]
  if (!best) return null

  // A tie means the recipient has not said enough to tell them apart.
  return scored[1]?.shared === best.shared ? null : best.item
}

/** Noise words that carry no naming information when someone speaks a title. */
const IGNORED = new Set(['the', 'a', 'an', 'my', 'routine', 'task', 'tasks', 'list', 'category'])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !IGNORED.has(word))
    .join(' ')
}
