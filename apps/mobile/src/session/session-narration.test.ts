import { describe, expect, it } from 'vitest'
import type { SequencedTask } from './guided-session'
import { narrate, spokenDuration } from './session-narration'

const task: SequencedTask = {
  id: 'teeth',
  title: 'Brush teeth',
  durationSeconds: 120,
  path: ['Morning routine', 'Wash up'],
}

describe('narrate', () => {
  it('opens with the routine the recipient recognises', () => {
    expect(narrate({ kind: 'present', task, reason: 'started', ordinal: 1, total: 3 })).toBe(
      'Let us start Morning routine. First, Brush teeth.',
    )
  })

  it('opens without a routine name when the task has no summary task above it', () => {
    const orphan = { ...task, path: [] }

    expect(
      narrate({ kind: 'present', task: orphan, reason: 'started', ordinal: 1, total: 1 }),
    ).toBe('Let us begin. First, Brush teeth.')
  })

  it('varies by reason', () => {
    const at = (reason: 'advanced' | 'returned' | 'resumed' | 'repeated') =>
      narrate({ kind: 'present', task, reason, ordinal: 2, total: 3 })

    expect(at('advanced')).toBe('Next, Brush teeth.')
    expect(at('returned')).toBe('Going back. Brush teeth.')
    expect(at('resumed')).toBe('Resuming. Brush teeth.')
    expect(at('repeated')).toBe('Brush teeth.')
  })

  it('answers duration, and says so when there is none', () => {
    expect(narrate({ kind: 'duration', task })).toBe('About 2 minutes.')
    expect(narrate({ kind: 'duration', task: { ...task, durationSeconds: null } })).toBe(
      'There is no time set for this one. Take as long as you need.',
    )
  })

  it('previews the next task or the end', () => {
    expect(narrate({ kind: 'preview', task })).toBe('Next is Brush teeth.')
    expect(narrate({ kind: 'preview', task: null })).toBe('That was the last one.')
  })

  it('covers the remaining effects', () => {
    expect(narrate({ kind: 'paused' })).toBe('Paused. Say resume when you are ready.')
    expect(narrate({ kind: 'atFirstTask' })).toBe('You are on the first one.')
    expect(narrate({ kind: 'finished', reason: 'completed' })).toBe(
      'That is everything. Nice work.',
    )
    expect(narrate({ kind: 'finished', reason: 'stopped' })).toBe('Stopping here.')
  })

  it('stays silent on an intent that did not apply', () => {
    expect(narrate({ kind: 'ignored' })).toBeNull()
  })
})

describe('spokenDuration', () => {
  it('reads durations the way they are said aloud', () => {
    expect(spokenDuration(30)).toBe('30 seconds')
    expect(spokenDuration(1)).toBe('1 second')
    expect(spokenDuration(60)).toBe('1 minute')
    expect(spokenDuration(120)).toBe('2 minutes')
    expect(spokenDuration(90)).toBe('1 minute 30 seconds')
  })

  it('has nothing to say for an unset or empty duration', () => {
    expect(spokenDuration(null)).toBeNull()
    expect(spokenDuration(0)).toBeNull()
  })
})
