import type { SpokenBrowseIntent } from './browse-navigation'

/**
 * Openings that ask for the list of categories, matched as whole utterances.
 */
const CATEGORY_LIST_PHRASES = new Set([
  'categories',
  'list categories',
  'list my categories',
  'what categories do i have',
  'what are my categories',
  'show my categories',
  'my categories',
  'what can i do',
])

const BACK_PHRASES = new Set(['back', 'go back', 'start over', 'never mind', 'cancel'])

/**
 * Openings that name a category, in the form "list tasks from kitchen". The
 * longest opening is tried first so "list tasks from" is not mistaken for
 * "list tasks" with "from kitchen" as the name.
 */
const ROUTINE_LIST_OPENINGS = [
  'list routines from',
  'list routines in',
  'list tasks from',
  'list tasks in',
  'show tasks from',
  'show tasks in',
  'show me',
  'what is in',
  'whats in',
  'open',
  'list',
  'show',
]

const START_OPENINGS = ['start the', 'begin the', 'lets do', 'let us do', 'start', 'begin', 'do']

/**
 * Maps a transcript to a browsing request, or null when it is not one.
 *
 * Unlike traversal commands, these carry a caretaker-written name the recipient
 * said out loud, so only the opening is matched here. Resolving the name to a
 * category or routine is left to the catalog, which is the only thing that knows
 * what was assigned.
 */
export function recognizeBrowseIntent(transcript: string): SpokenBrowseIntent | null {
  const normalized = normalize(transcript)
  if (!normalized) return null

  if (CATEGORY_LIST_PHRASES.has(normalized)) return { kind: 'listCategories' }
  if (BACK_PHRASES.has(normalized)) return { kind: 'back' }

  // Starting is checked first: "start kitchen cleanup" names a routine, and a
  // recipient who has said a name wants it run rather than listed.
  const starting = after(normalized, START_OPENINGS)
  if (starting) return { kind: 'start', spoken: starting }

  const listing = after(normalized, ROUTINE_LIST_OPENINGS)
  if (listing) return { kind: 'listRoutines', spoken: listing }

  return null
}

/** The remainder after the first opening that this utterance begins with. */
function after(normalized: string, openings: readonly string[]): string | null {
  for (const opening of openings) {
    if (!normalized.startsWith(`${opening} `)) continue

    const remainder = normalized.slice(opening.length + 1).trim()
    if (remainder) return remainder
  }

  return null
}

const LEADING_FILLER = new Set(['okay', 'ok', 'um', 'uh', 'so', 'and', 'well', 'yeah', 'alright'])

/**
 * Closing words that carry no request. Both openings here are matched as whole
 * utterances, so without this "list my categories please" and "go back please"
 * fall through as if nothing had been said.
 */
const TRAILING_FILLER = new Set(['please', 'thanks', 'now'])

function normalize(transcript: string): string {
  const words = transcript
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  let start = 0
  while (start < words.length && LEADING_FILLER.has(words[start] as string)) start += 1

  let end = words.length
  while (end > start && TRAILING_FILLER.has(words[end - 1] as string)) end -= 1

  return words.slice(start, end).join(' ')
}
