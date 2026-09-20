import type { TaskNode } from '@helping-hand/schemas'
import { describe, expect, it } from 'vitest'
import {
  applyIntent,
  currentTask,
  type GuidedSession,
  type SessionIntent,
  startSession,
} from './guided-session'

const tree: TaskNode = {
  id: 'root',
  title: 'Morning routine',
  durationSeconds: null,
  children: [
    { id: 'teeth', title: 'Brush teeth', durationSeconds: 120, children: [] },
    { id: 'face', title: 'Wash face', durationSeconds: 30, children: [] },
    { id: 'dress', title: 'Get dressed', durationSeconds: null, children: [] },
  ],
}

function run(...intents: SessionIntent[]): GuidedSession {
  return intents.reduce<GuidedSession>(
    (session, intent) => applyIntent(session, intent).session,
    startSession(tree).session,
  )
}

describe('startSession', () => {
  it('presents the first actionable task', () => {
    const { session, effect } = startSession(tree)

    expect(currentTask(session)?.title).toBe('Brush teeth')
    expect(effect).toMatchObject({ kind: 'present', reason: 'started', ordinal: 1, total: 3 })
  })

  it('presents a childless root as its own single task', () => {
    const single: TaskNode = {
      id: 'root',
      title: 'Take medication',
      durationSeconds: null,
      children: [],
    }
    const { session, effect } = startSession(single)

    expect(currentTask(session)?.title).toBe('Take medication')
    expect(effect).toMatchObject({ kind: 'present', ordinal: 1, total: 1 })
  })
})

describe('traversal', () => {
  it('advances on next', () => {
    const { session, effect } = applyIntent(startSession(tree).session, 'next')

    expect(currentTask(session)?.title).toBe('Wash face')
    expect(effect).toMatchObject({ kind: 'present', reason: 'advanced', ordinal: 2 })
  })

  it('completes after the last actionable task', () => {
    const { session, effect } = applyIntent(run('next', 'next'), 'next')

    expect(session.status).toBe('ended')
    expect(currentTask(session)).toBeNull()
    expect(effect).toEqual({ kind: 'finished', reason: 'completed' })
  })

  it('returns on back', () => {
    const { session, effect } = applyIntent(run('next'), 'back')

    expect(currentTask(session)?.title).toBe('Brush teeth')
    expect(effect).toMatchObject({ kind: 'present', reason: 'returned' })
  })

  it('reports the edge instead of moving when already on the first task', () => {
    const { session, effect } = applyIntent(startSession(tree).session, 'back')

    expect(session.index).toBe(0)
    expect(effect).toEqual({ kind: 'atFirstTask' })
  })

  it('repeats without moving', () => {
    const { session, effect } = applyIntent(run('next'), 'repeat')

    expect(session.index).toBe(1)
    expect(effect).toMatchObject({ kind: 'present', reason: 'repeated', ordinal: 2 })
  })
})

describe('local answers', () => {
  it('answers duration from the current task', () => {
    const { session, effect } = applyIntent(startSession(tree).session, 'duration')

    expect(session.index).toBe(0)
    expect(effect).toEqual({ kind: 'duration', task: expect.objectContaining({ id: 'teeth' }) })
  })

  it('previews the next task without advancing', () => {
    const { session, effect } = applyIntent(startSession(tree).session, 'preview')

    expect(currentTask(session)?.title).toBe('Brush teeth')
    expect(effect).toEqual({ kind: 'preview', task: expect.objectContaining({ id: 'face' }) })
  })

  it('previews nothing on the last task', () => {
    expect(applyIntent(run('next', 'next'), 'preview').effect).toEqual({
      kind: 'preview',
      task: null,
    })
  })
})

describe('pause', () => {
  it('pauses and re-presents the same task on resume', () => {
    const paused = applyIntent(run('next'), 'pause')
    expect(paused.session.status).toBe('paused')
    expect(paused.effect).toEqual({ kind: 'paused' })

    const resumed = applyIntent(paused.session, 'resume')
    expect(resumed.session.status).toBe('active')
    expect(resumed.effect).toMatchObject({ kind: 'present', reason: 'resumed', ordinal: 2 })
  })

  it('ignores traversal while paused', () => {
    const paused = applyIntent(run('next'), 'pause').session

    for (const intent of ['next', 'back', 'repeat', 'preview', 'pause'] as const) {
      const result = applyIntent(paused, intent)
      expect(result.effect).toEqual({ kind: 'ignored' })
      expect(result.session).toEqual(paused)
    }
  })

  it('still stops while paused', () => {
    const { session, effect } = applyIntent(applyIntent(run('next'), 'pause').session, 'stop')

    expect(session.status).toBe('ended')
    expect(effect).toEqual({ kind: 'finished', reason: 'stopped' })
  })
})

describe('ended sessions', () => {
  it('ignores every intent once ended', () => {
    const ended = applyIntent(startSession(tree).session, 'stop').session

    for (const intent of ['next', 'back', 'repeat', 'resume', 'stop'] as const) {
      expect(applyIntent(ended, intent)).toEqual({ session: ended, effect: { kind: 'ignored' } })
    }
  })

  it('leaves the saved tree untouched', () => {
    const snapshot = structuredClone(tree)
    run('next', 'back', 'pause', 'resume', 'stop')

    expect(tree).toEqual(snapshot)
  })
})
