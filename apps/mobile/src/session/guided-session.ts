import type { TaskNode } from '@helping-hand/schemas'
import { type SequencedTask, sequenceActionableTasks } from './actionable-task-sequence'

export type { SequencedTask }

/**
 * Everything a recipient can ask of a running session without leaving the
 * device. Anything outside this set is a question for the assistant, not a
 * traversal command.
 */
export type SessionIntent =
  | 'next'
  | 'back'
  | 'repeat'
  | 'duration'
  | 'preview'
  | 'pause'
  | 'resume'
  | 'stop'

export type SessionStatus = 'active' | 'paused' | 'ended'

/**
 * A temporary traversal of one task tree. Position lives here and nowhere else,
 * so ending a session discards it without touching the saved tree.
 */
export type GuidedSession = {
  readonly tasks: readonly SequencedTask[]
  readonly index: number
  readonly status: SessionStatus
}

/** Why the current actionable task is being presented, so speech can vary. */
export type PresentReason = 'started' | 'advanced' | 'returned' | 'repeated' | 'resumed'

/**
 * What the session wants said or done next. Callers render these; the session
 * holds no copy of its own, so phrasing can change without touching traversal.
 */
export type SessionEffect =
  | {
      readonly kind: 'present'
      readonly task: SequencedTask
      readonly reason: PresentReason
      readonly ordinal: number
      readonly total: number
    }
  | { readonly kind: 'duration'; readonly task: SequencedTask }
  | { readonly kind: 'preview'; readonly task: SequencedTask | null }
  | { readonly kind: 'paused' }
  | { readonly kind: 'atFirstTask' }
  | { readonly kind: 'finished'; readonly reason: 'completed' | 'stopped' }
  | { readonly kind: 'ignored' }

export type SessionTransition = {
  readonly session: GuidedSession
  readonly effect: SessionEffect
}

/** The actionable task a session is currently on, or null once it has ended. */
export function currentTask(session: GuidedSession): SequencedTask | null {
  if (session.status === 'ended') return null
  return session.tasks[session.index] ?? null
}

/**
 * Begins a traversal at the first actionable task. A tree that sequences to
 * nothing cannot be traversed, so the session starts already finished rather
 * than sitting on a position that does not exist.
 */
export function startSession(root: TaskNode): SessionTransition {
  const tasks = sequenceActionableTasks(root)
  const first = tasks[0]

  if (!first) {
    return {
      session: { tasks, index: 0, status: 'ended' },
      effect: { kind: 'finished', reason: 'completed' },
    }
  }

  return {
    session: { tasks, index: 0, status: 'active' },
    effect: present(first, 'started', 0, tasks.length),
  }
}

/**
 * Applies one intent. Always returns a session: an intent that does not apply
 * yields the session unchanged with an `ignored` effect, so a misheard command
 * can never leave the traversal in a state the caller has to repair.
 */
export function applyIntent(session: GuidedSession, intent: SessionIntent): SessionTransition {
  if (session.status === 'ended') return unchanged(session)

  if (intent === 'stop') {
    return {
      session: { ...session, status: 'ended' },
      effect: { kind: 'finished', reason: 'stopped' },
    }
  }

  if (session.status === 'paused') {
    // Pause exists for interruptions, so only resuming leaves it. Resuming
    // re-presents the task rather than advancing: a recipient coming back needs
    // to hear where they are before being moved.
    if (intent !== 'resume') return unchanged(session)
    return presentAt({ ...session, status: 'active' }, session.index, 'resumed')
  }

  switch (intent) {
    case 'pause':
      return { session: { ...session, status: 'paused' }, effect: { kind: 'paused' } }

    case 'resume':
      return unchanged(session)

    case 'repeat':
      return presentAt(session, session.index, 'repeated')

    case 'back':
      if (session.index === 0) return { session, effect: { kind: 'atFirstTask' } }
      return presentAt(session, session.index - 1, 'returned')

    case 'next': {
      const nextIndex = session.index + 1
      if (nextIndex >= session.tasks.length) {
        return {
          session: { ...session, status: 'ended' },
          effect: { kind: 'finished', reason: 'completed' },
        }
      }
      return presentAt(session, nextIndex, 'advanced')
    }

    case 'duration': {
      const task = session.tasks[session.index]
      if (!task) return unchanged(session)
      return { session, effect: { kind: 'duration', task } }
    }

    case 'preview':
      return {
        session,
        effect: { kind: 'preview', task: session.tasks[session.index + 1] ?? null },
      }
  }
}

function present(
  task: SequencedTask,
  reason: PresentReason,
  index: number,
  total: number,
): SessionEffect {
  return { kind: 'present', task, reason, ordinal: index + 1, total }
}

function presentAt(
  session: GuidedSession,
  index: number,
  reason: PresentReason,
): SessionTransition {
  const task = session.tasks[index]
  if (!task) return unchanged(session)

  return {
    session: { ...session, index },
    effect: present(task, reason, index, session.tasks.length),
  }
}

function unchanged(session: GuidedSession): SessionTransition {
  return { session, effect: { kind: 'ignored' } }
}
