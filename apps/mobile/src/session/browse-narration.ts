import type { BrowseEffect } from './browse-navigation'

/**
 * Turns a browsing effect into the words spoken to the recipient.
 *
 * Lists are the hard part of a voice-only interface: a recipient cannot glance
 * back at one. Long lists are read in full anyway rather than truncated, because
 * a routine that is never spoken is a routine they cannot start, but the count
 * is said first so they know how long they are listening for.
 */
export function narrateBrowse(effect: BrowseEffect): string {
  switch (effect.kind) {
    case 'categories': {
      const names = effect.categories.map((category) => category.name)
      return `You have ${countOf(names.length, 'group')}: ${spokenList(names)}. Say the name of one to hear what is in it.`
    }

    case 'routines': {
      const titles = effect.category.routines.map((routine) => routine.title)
      return `${effect.category.name} has ${countOf(titles.length, 'routine')}: ${spokenList(titles)}. Say start, then the name of one.`
    }

    case 'nothingAssigned':
      return 'Nothing is assigned to this device yet. Ask your caretaker to add a routine.'

    case 'unknownCategory':
      return `I could not find a group called ${effect.spoken}. Say list my categories to hear them.`

    case 'unknownRoutine':
      return `I could not find a routine called ${effect.spoken}. Say list my categories to hear what you have.`

    case 'starting':
      return `Starting ${effect.routine.title}.`

    case 'atCatalog':
      return 'You are at the top. Say list my categories to hear them.'
  }
}

function countOf(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? '' : 's'}`
}

/** Reads a list the way it would be said: commas, with "and" before the last. */
export function spokenList(values: readonly string[]): string {
  if (values.length === 0) return 'nothing'
  if (values.length === 1) return values[0] as string

  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`
}
