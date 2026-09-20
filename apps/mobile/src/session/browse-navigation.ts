import type { RecipientTaskTree } from '@helping-hand/schemas'
import { type CatalogCategory, findCategory, findRoutine } from './task-catalog'

/** What a recipient can ask for before a routine is running. */
export type BrowseIntent =
  | { readonly kind: 'listCategories' }
  | { readonly kind: 'listRoutines'; readonly spoken: string }
  | { readonly kind: 'start'; readonly spoken: string }
  | { readonly kind: 'back' }

/** Where the recipient is in the catalog. */
export type BrowsePosition =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'category'; readonly category: CatalogCategory }

export type BrowseEffect =
  | { readonly kind: 'categories'; readonly categories: readonly CatalogCategory[] }
  | { readonly kind: 'routines'; readonly category: CatalogCategory }
  | { readonly kind: 'nothingAssigned' }
  | { readonly kind: 'unknownCategory'; readonly spoken: string }
  | { readonly kind: 'unknownRoutine'; readonly spoken: string }
  | { readonly kind: 'starting'; readonly routine: RecipientTaskTree }
  | { readonly kind: 'atCatalog' }

export type BrowseTransition = {
  readonly position: BrowsePosition
  readonly effect: BrowseEffect
}

/**
 * Moves around the catalog by voice.
 *
 * Starting a routine is deliberately reachable from anywhere: a recipient who
 * knows what they want should not have to walk the categories first, so a name
 * is looked for in the current category and then across everything assigned.
 * Narrowing to a category only changes what gets listed and what a bare name
 * resolves to first.
 */
export function browse(
  catalog: readonly CatalogCategory[],
  position: BrowsePosition,
  intent: BrowseIntent,
): BrowseTransition {
  if (catalog.length === 0) {
    return { position: { kind: 'catalog' }, effect: { kind: 'nothingAssigned' } }
  }

  switch (intent.kind) {
    case 'listCategories':
      return { position: { kind: 'catalog' }, effect: { kind: 'categories', categories: catalog } }

    case 'back':
      return {
        position: { kind: 'catalog' },
        effect:
          position.kind === 'catalog'
            ? { kind: 'atCatalog' }
            : { kind: 'categories', categories: catalog },
      }

    case 'listRoutines': {
      const category = findCategory(catalog, intent.spoken)
      if (!category) {
        return { position, effect: { kind: 'unknownCategory', spoken: intent.spoken } }
      }

      return { position: { kind: 'category', category }, effect: { kind: 'routines', category } }
    }

    case 'start': {
      const routine = findStartable(catalog, position, intent.spoken)
      if (!routine) {
        return { position, effect: { kind: 'unknownRoutine', spoken: intent.spoken } }
      }

      return { position, effect: { kind: 'starting', routine } }
    }
  }
}

function findStartable(
  catalog: readonly CatalogCategory[],
  position: BrowsePosition,
  spoken: string,
): RecipientTaskTree | null {
  if (position.kind === 'category') {
    const withinCategory = findRoutine(position.category.routines, spoken)
    if (withinCategory) return withinCategory
  }

  return findRoutine(
    catalog.flatMap((category) => category.routines),
    spoken,
  )
}
