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
