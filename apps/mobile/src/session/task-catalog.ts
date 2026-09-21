import type { RecipientTaskTree } from '@helping-hand/schemas'
import { matchByName } from './spoken-match'

/** Routines grouped the way a recipient would ask for them. */
export type CatalogCategory = {
  readonly id: string
  readonly name: string
  readonly routines: readonly RecipientTaskTree[]
}

export const UNCATEGORISED_NAME = 'Everything else'

/**
 * The id standing in for "no category". Routines a caretaker never filed still
 * have to be reachable, and a recipient picking that group from a screen needs
 * something to point at. Category ids are UUIDs, so this cannot collide with
 * one, and giving the bucket a real id keeps `null` out of the catalog entirely.
 */
export const UNCATEGORISED_ID = 'uncategorised'

/**
 * Groups assigned routines by the category their caretaker put them in.
 *
 * Categories keep the order their first routine arrived in, so what a recipient
 * hears listed stays stable between sessions. Routines without a category are
 * gathered at the end rather than hidden: a recipient who was assigned one still
 * has to be able to reach it.
 */
export function buildCatalog(trees: readonly RecipientTaskTree[]): CatalogCategory[] {
  const grouped = new Map<string, { id: string; name: string; routines: RecipientTaskTree[] }>()

  for (const tree of trees) {
    const key = tree.category?.id ?? UNCATEGORISED_ID
    const existing = grouped.get(key)

    if (existing) {
      existing.routines.push(tree)
      continue
    }

    grouped.set(key, {
      id: key,
      name: tree.category?.name ?? UNCATEGORISED_NAME,
      routines: [tree],
    })
  }

  const categories = [...grouped.values()]

  return [
    ...categories.filter((category) => category.id !== UNCATEGORISED_ID),
    ...categories.filter((category) => category.id === UNCATEGORISED_ID),
  ]
}

export function findCategory(
  catalog: readonly CatalogCategory[],
  spoken: string,
): CatalogCategory | null {
  return matchByName(catalog, spoken, (category) => category.name)
}

export function findRoutine(
  routines: readonly RecipientTaskTree[],
  spoken: string,
): RecipientTaskTree | null {
  return matchByName(routines, spoken, (routine) => routine.title)
}

/** Every name a recipient might say, for biasing a speech recognizer. */
export function catalogPhrases(catalog: readonly CatalogCategory[]): string[] {
  return catalog.flatMap((category) => [
    category.name,
    ...category.routines.map((routine) => routine.title),
  ])
}
