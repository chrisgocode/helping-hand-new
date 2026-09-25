import { describe, expect, it } from 'vitest'
import { narrateBrowse, spokenList } from './browse-narration'
import { buildCatalog } from './task-catalog'

const kitchen = { id: '11111111-1111-4111-8111-111111111111', name: 'Kitchen' }

const catalog = buildCatalog([
  { id: 'a', title: 'Wash up', durationSeconds: null, children: [], category: kitchen },
  { id: 'b', title: 'Make coffee', durationSeconds: null, children: [], category: kitchen },
])

describe('narrateBrowse', () => {
  it('counts the categories before reading them', () => {
    expect(narrateBrowse({ kind: 'categories', categories: catalog })).toBe(
      'You have 1 category: Kitchen. Say the name of one to hear what is in it.',
    )
  })

  it('reads the routines in a category', () => {
    expect(narrateBrowse({ kind: 'routines', category: catalog[0] as never })).toBe(
      'Kitchen has 2 routines: Wash up and Make coffee. Say start, then the name of one.',
    )
  })

  it('explains an unrecognised name instead of failing silently', () => {
    expect(narrateBrowse({ kind: 'unknownCategory', spoken: 'garage' })).toContain('garage')
    expect(narrateBrowse({ kind: 'unknownRoutine', spoken: 'gardening' })).toContain('gardening')
  })

  it('says a picked routine has gone without blaming the recipient', () => {
    const line = narrateBrowse({ kind: 'selectionUnavailable' })

    expect(line).toContain('not on your list any more')
    // `unknownRoutine` is the misheard-you message; a button press was heard
    // perfectly and must not get that wording.
    expect(line).not.toContain('could not find')
  })

  it('covers the remaining effects', () => {
    expect(narrateBrowse({ kind: 'nothingAssigned' })).toContain('Nothing is assigned')
    expect(narrateBrowse({ kind: 'atCatalog' })).toContain('top')
    expect(
      narrateBrowse({
        kind: 'starting',
        routine: { id: 'a', title: 'Wash up', durationSeconds: null, children: [], category: null },
      }),
    ).toBe('Starting Wash up.')
  })
})

describe('spokenList', () => {
  it('reads a list the way it is said aloud', () => {
    expect(spokenList([])).toBe('nothing')
    expect(spokenList(['one'])).toBe('one')
    expect(spokenList(['one', 'two'])).toBe('one and two')
    expect(spokenList(['one', 'two', 'three'])).toBe('one, two and three')
  })
})
