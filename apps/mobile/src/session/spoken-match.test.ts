import { describe, expect, it } from 'vitest'
import { matchByName } from './spoken-match'

const named = (name: string) => ({ name })
const nameOf = (item: { name: string }) => item.name

describe('matchByName', () => {
  const items = [named('Kitchen'), named('Morning routine'), named('Evening wind down')]

  it('matches an exact name regardless of casing and punctuation', () => {
    expect(matchByName(items, 'kitchen', nameOf)).toEqual(named('Kitchen'))
    expect(matchByName(items, 'Kitchen!', nameOf)).toEqual(named('Kitchen'))
  })

  it('matches a name the recipient only partly said', () => {
    expect(matchByName(items, 'morning', nameOf)).toEqual(named('Morning routine'))
    expect(matchByName(items, 'evening wind down please', nameOf)).toEqual(
      named('Evening wind down'),
    )
  })

  it('ignores words that carry no naming information', () => {
    expect(matchByName(items, 'the kitchen', nameOf)).toEqual(named('Kitchen'))
    expect(matchByName(items, 'my morning routine', nameOf)).toEqual(named('Morning routine'))
  })

  it('falls back to shared words when nothing contains the other', () => {
    expect(matchByName(items, 'wind down for the evening', nameOf)).toEqual(
      named('Evening wind down'),
    )
  })

  it('refuses to guess between equally good matches', () => {
    const ambiguous = [named('Morning walk'), named('Morning shower')]

    expect(matchByName(ambiguous, 'morning', nameOf)).toBeNull()
  })

  it('never matches a name that normalizes to nothing', () => {
    // Every word ignored, so containment against it would otherwise be true for
    // any utterance and it would win as the only candidate.
    const unreachable = [named('The list'), named('Tasks'), named('日課')]

    for (const spoken of ['kitchen', 'start the gardening', 'anything at all']) {
      expect(matchByName(unreachable, spoken, nameOf)).toBeNull()
    }
  })

  it('does not let an unnameable item shadow a real match', () => {
    const mixed = [named('Tasks'), named('Kitchen')]

    expect(matchByName(mixed, 'kitchen', nameOf)).toEqual(named('Kitchen'))
  })

  it('returns nothing for an empty or unmatched name', () => {
    expect(matchByName(items, '', nameOf)).toBeNull()
    expect(matchByName(items, 'gardening', nameOf)).toBeNull()
    expect(matchByName([], 'kitchen', nameOf)).toBeNull()
  })
})
