import type { PresentReason, SequencedTask, SessionEffect } from './guided-session'

/**
 * Turns a session effect into the words spoken to the recipient.
 *
 * All of a session's phrasing lives here, so traversal stays free of copy and
 * the wording can be reviewed as a whole. Lines are short on purpose: spoken
 * audio cannot be skimmed, and the glasses render it at 8 kHz mono, so every
 * extra word is one the recipient has to sit through.
 *
 * Returns null when the session should stay silent.
 */
export function narrate(effect: SessionEffect): string | null {
  switch (effect.kind) {
    case 'present':
      return narratePresent(effect.task, effect.reason)

    case 'duration':
      return narrateDuration(effect.task)

    case 'preview':
      return effect.task ? `Next is ${effect.task.title}.` : 'That was the last one.'

    case 'paused':
      return 'Paused. Say resume when you are ready.'

    case 'atFirstTask':
      return 'You are on the first one.'

    case 'finished':
      return effect.reason === 'completed' ? 'That is everything. Nice work.' : 'Stopping here.'

    // A command that did not apply is silence rather than a correction: the
    // recipient is mid-task and does not need to be told what they cannot do.
    case 'ignored':
      return null
  }
}

function narratePresent(task: SequencedTask, reason: PresentReason): string {
  switch (reason) {
    case 'started': {
      // The outermost summary task is the name the recipient recognises, so a
      // session opens by saying what they are about to do.
      const routine = task.path[0]
      const opening = routine ? `Let us start ${routine}.` : 'Let us begin.'
      return `${opening} First, ${task.title}.`
    }

    case 'advanced':
      return `Next, ${task.title}.`

    case 'returned':
      return `Going back. ${task.title}.`

    case 'resumed':
      return `Resuming. ${task.title}.`

    case 'repeated':
      return `${task.title}.`
  }
}

function narrateDuration(task: SequencedTask): string {
  const spoken = spokenDuration(task.durationSeconds)
  return spoken
    ? `About ${spoken}.`
    : 'There is no time set for this one. Take as long as you need.'
}

/**
 * Renders a duration the way it would be said aloud. Durations are guidance
 * rather than a deadline, so they are rounded rather than read out precisely.
 */
export function spokenDuration(durationSeconds: number | null): string | null {
  if (durationSeconds === null || durationSeconds <= 0) return null

  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60

  if (minutes === 0) return plural(seconds, 'second')
  if (seconds === 0) return plural(minutes, 'minute')

  return `${plural(minutes, 'minute')} ${plural(seconds, 'second')}`
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}
