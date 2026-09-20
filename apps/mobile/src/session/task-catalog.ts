import type { RecipientTaskTree } from '@helping-hand/schemas'
import { matchByName } from './spoken-match'

/** Routines grouped the way a recipient would ask for them. */
export type CatalogCategory = {
  readonly id: string | null
  readonly name: string
  readonly routines: readonly RecipientTaskTree[]
}

export const UNCATEGORISED_NAME = 'Everything else'

/**
 * Groups assigned routines by the category their caretaker put them in.
 *
 * Categories keep the order their first routine arrived in, so what a recipient
 * hears listed stays stable between sessions. Routines without a category are
 * gathered at the end rather than hidden: a recipient who was assigned one still
 * has to be able to reach it.
 */
export function buildCatalog(trees: readonly RecipientTaskTree[]): CatalogCategory[] {
  const grouped = new Map<
    string,
    { id: string | null; name: string; routines: RecipientTaskTree[] }
  >()

  for (const tree of trees) {
    const key = tree.category?.id ?? ''
    const existing = grouped.get(key)

    if (existing) {
      existing.routines.push(tree)
      continue
    }

    grouped.set(key, {
      id: tree.category?.id ?? null,
      name: tree.category?.name ?? UNCATEGORISED_NAME,
      routines: [tree],
    })
  }

  const categories = [...grouped.values()]

  return [
    ...categories.filter((category) => category.id !== null),
    ...categories.filter((category) => category.id === null),
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
