const LEADING_FILLER = new Set(['okay', 'ok', 'um', 'uh', 'so', 'and', 'well', 'yeah', 'alright'])
const TRAILING_FILLER = new Set(['please', 'thanks', 'now'])
const NAME_FILLER = new Set([
  'the',
  'a',
  'an',
  'my',
  'routine',
  'task',
  'tasks',
  'list',
  'category',
])

const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Normalizes a whole spoken command while removing conversational filler. */
export function normalizeUtterance(value: string): string {
  const normalized = words(value)

  let start = 0
  while (start < normalized.length && LEADING_FILLER.has(normalized[start] as string)) start += 1

  let end = normalized.length
  while (end > start && TRAILING_FILLER.has(normalized[end - 1] as string)) end -= 1

  return normalized.slice(start, end).join(' ')
}

/** Normalizes a caretaker-written name while removing words with no naming value. */
export function normalizeName(value: string): string {
  return words(value)
    .filter((word) => !NAME_FILLER.has(word))
    .join(' ')
}
