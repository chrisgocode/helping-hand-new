import type { RecipientTaskTree } from '@helping-hand/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildCatalog,
  catalogPhrases,
  findCategory,
  findRoutine,
  UNCATEGORISED_NAME,
} from './task-catalog'

function routine(id: string, title: string, category: { id: string; name: string } | null) {
  return { id, title, durationSeconds: null, children: [], category } satisfies RecipientTaskTree
}

const kitchen = { id: '11111111-1111-4111-8111-111111111111', name: 'Kitchen' }
const bathroom = { id: '22222222-2222-4222-8222-222222222222', name: 'Bathroom' }

const trees = [
  routine('a', 'Wash up', kitchen),
  routine('b', 'Morning routine', bathroom),
  routine('c', 'Make coffee', kitchen),
  routine('d', 'Take medication', null),
]

describe('buildCatalog', () => {
  it('groups routines under the category their caretaker chose', () => {
    const catalog = buildCatalog(trees)

    expect(catalog.map((category) => category.name)).toEqual([
      'Kitchen',
      'Bathroom',
      UNCATEGORISED_NAME,
    ])
    expect(catalog[0]?.routines.map((entry) => entry.title)).toEqual(['Wash up', 'Make coffee'])
  })

  it('keeps uncategorised routines reachable at the end', () => {
    const catalog = buildCatalog(trees)
    const last = catalog.at(-1)

    expect(last?.id).toBeNull()
    expect(last?.routines.map((entry) => entry.title)).toEqual(['Take medication'])
  })

  it('has nothing to group when nothing is assigned', () => {
    expect(buildCatalog([])).toEqual([])
  })
})

describe('finding by spoken name', () => {
  const catalog = buildCatalog(trees)

  it('finds a category the recipient named', () => {
    expect(findCategory(catalog, 'kitchen')?.name).toBe('Kitchen')
    expect(findCategory(catalog, 'the bathroom')?.name).toBe('Bathroom')
    expect(findCategory(catalog, 'garage')).toBeNull()
  })

  it('finds a routine the recipient named', () => {
    expect(findRoutine(trees, 'make coffee')?.id).toBe('c')
    expect(findRoutine(trees, 'coffee')?.id).toBe('c')
    expect(findRoutine(trees, 'gardening')).toBeNull()
  })
})

describe('catalogPhrases', () => {
  it('offers every name a recipient might say', () => {
    expect(catalogPhrases(buildCatalog(trees))).toEqual([
      'Kitchen',
      'Wash up',
      'Make coffee',
      'Bathroom',
      'Morning routine',
      UNCATEGORISED_NAME,
      'Take medication',
    ])
  })
})
