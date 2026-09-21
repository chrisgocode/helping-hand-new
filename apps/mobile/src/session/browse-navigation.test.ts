import type { RecipientTaskTree } from '@helping-hand/schemas'
import { describe, expect, it } from 'vitest'
import { type BrowsePosition, browse } from './browse-navigation'
import { buildCatalog } from './task-catalog'

function routine(id: string, title: string, category: { id: string; name: string } | null) {
  return { id, title, durationSeconds: null, children: [], category } satisfies RecipientTaskTree
}

const kitchen = { id: '11111111-1111-4111-8111-111111111111', name: 'Kitchen' }
const bathroom = { id: '22222222-2222-4222-8222-222222222222', name: 'Bathroom' }

const catalog = buildCatalog([
  routine('a', 'Wash up', kitchen),
  routine('b', 'Make coffee', kitchen),
  routine('c', 'Morning routine', bathroom),
])

const atCatalog: BrowsePosition = { kind: 'catalog' }
const inKitchen: BrowsePosition = { kind: 'category', category: catalog[0] as never }

describe('browse by a direct pick', () => {
  // Both of these are reachable by tapping a button on the session screen, and
  // both failed while the screen sent the name back to be matched again.
  it('opens a category whose name matches nothing when spoken', () => {
    const unnameable = buildCatalog([
      routine('a', 'Wash up', { id: '33333333-3333-4333-8333-333333333333', name: 'Tasks' }),
    ])
    const target = unnameable[0] as never as { id: string }

    // "Tasks" is all ignored words, so it normalizes to the empty string.
    expect(
      browse(unnameable, atCatalog, { kind: 'listRoutines', spoken: 'Tasks' }).effect.kind,
    ).toBe('unknownCategory')
    expect(
      browse(unnameable, atCatalog, { kind: 'openCategory', categoryId: target.id }).effect,
    ).toEqual({ kind: 'routines', category: unnameable[0] })
  })

  it('starts a routine whose name ties with another', () => {
    const ambiguous = buildCatalog([
      routine('a', 'Morning routine', kitchen),
      routine('b', 'The morning', kitchen),
    ])

    expect(
      browse(ambiguous, atCatalog, { kind: 'start', spoken: 'Morning routine' }).effect.kind,
    ).toBe('unknownRoutine')
    expect(browse(ambiguous, atCatalog, { kind: 'startRoutine', routineId: 'a' }).effect).toEqual({
      kind: 'starting',
      routine: ambiguous[0]?.routines[0],
    })
  })

  it('ignores where the recipient is when the routine is named outright', () => {
    // 'c' lives in Bathroom; the recipient is in Kitchen. An id identifies one
    // routine in the whole catalog, so position has nothing to disambiguate.
    expect(
      browse(catalog, inKitchen, { kind: 'startRoutine', routineId: 'c' }).effect,
    ).toMatchObject({ kind: 'starting', routine: { title: 'Morning routine' } })
  })

  it('says a pick is gone rather than that it was misheard', () => {
    const goneRoutine = browse(catalog, inKitchen, {
      kind: 'startRoutine',
      routineId: 'no-such-routine',
    })
    const goneCategory = browse(catalog, atCatalog, {
      kind: 'openCategory',
      categoryId: 'no-such-category',
    })

    expect(goneRoutine.effect).toEqual({ kind: 'selectionUnavailable' })
    expect(goneCategory.effect).toEqual({ kind: 'selectionUnavailable' })
    // A selection that has gone must not move the recipient somewhere else.
    expect(goneRoutine.position).toEqual(inKitchen)
    expect(goneCategory.position).toEqual(atCatalog)
  })
})

describe('browse', () => {
  it('lists the categories', () => {
    const { position, effect } = browse(catalog, atCatalog, { kind: 'listCategories' })

    expect(position).toEqual(atCatalog)
    expect(effect).toEqual({ kind: 'categories', categories: catalog })
  })

  it('narrows into a category the recipient named', () => {
    const { position, effect } = browse(catalog, atCatalog, {
      kind: 'listRoutines',
      spoken: 'kitchen',
    })

    expect(position).toEqual({ kind: 'category', category: catalog[0] })
    expect(effect).toMatchObject({ kind: 'routines' })
  })

  it('stays put when the category is not recognised', () => {
    const { position, effect } = browse(catalog, inKitchen, {
      kind: 'listRoutines',
      spoken: 'garage',
    })

    expect(position).toEqual(inKitchen)
    expect(effect).toEqual({ kind: 'unknownCategory', spoken: 'garage' })
  })

  it('starts a routine without walking the categories first', () => {
    const { effect } = browse(catalog, atCatalog, { kind: 'start', spoken: 'morning routine' })

    expect(effect).toMatchObject({ kind: 'starting', routine: { id: 'c' } })
  })

  it('starts a routine from inside a category', () => {
    const { effect } = browse(catalog, inKitchen, { kind: 'start', spoken: 'make coffee' })

    expect(effect).toMatchObject({ kind: 'starting', routine: { id: 'b' } })
  })

  it('reaches a routine outside the current category', () => {
    const { effect } = browse(catalog, inKitchen, { kind: 'start', spoken: 'morning routine' })

    expect(effect).toMatchObject({ kind: 'starting', routine: { id: 'c' } })
  })

  it('says so rather than guessing at an unknown routine', () => {
    const { position, effect } = browse(catalog, inKitchen, { kind: 'start', spoken: 'gardening' })

    expect(position).toEqual(inKitchen)
    expect(effect).toEqual({ kind: 'unknownRoutine', spoken: 'gardening' })
  })

  it('returns to the catalog, and says so when already there', () => {
    expect(browse(catalog, inKitchen, { kind: 'back' })).toEqual({
      position: atCatalog,
      effect: { kind: 'categories', categories: catalog },
    })
    expect(browse(catalog, atCatalog, { kind: 'back' }).effect).toEqual({ kind: 'atCatalog' })
  })

  it('reports an empty catalog whatever is asked of it', () => {
    for (const intent of [
      { kind: 'listCategories' },
      { kind: 'start', spoken: 'anything' },
    ] as const) {
      expect(browse([], atCatalog, intent)).toEqual({
        position: atCatalog,
        effect: { kind: 'nothingAssigned' },
      })
    }
  })
})
