import { describe, expect, it } from 'vitest'
import type { AudioRouteDescription } from '../../modules/audio-route'
import {
  type CaptureTake,
  currentPrompt,
  isComplete,
  recordTake,
  redoLast,
  scoreTake,
  startRun,
  summarise,
} from './capture-run'
import { CAPTURE_SCRIPT } from './capture-script'

const glassesRoute: AudioRouteDescription = {
  inputs: [{ portType: 'BluetoothHFP', portName: 'Vanguard' }],
  outputs: [{ portType: 'BluetoothHFP', portName: 'Vanguard' }],
}

const phoneRoute: AudioRouteDescription = {
  inputs: [{ portType: 'BuiltInMic', portName: 'iPhone Microphone' }],
  outputs: [{ portType: 'Speaker', portName: 'Speaker' }],
}

const take = (overrides: Partial<CaptureTake>): CaptureTake => ({
  promptId: 'cmd-done',
  say: 'Done',
  purpose: 'command',
  expect: 'next',
  environment: 'quiet',
  transcript: 'done',
  uri: 'file:///take.wav',
  throughGlasses: true,
  recordedAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
})

describe('walking the script', () => {
  it('starts at the first prompt', () => {
    const run = startRun('quiet')

    expect(currentPrompt(run)).toEqual(CAPTURE_SCRIPT[0])
    expect(isComplete(run)).toBe(false)
  })

  it('advances and keeps what was heard', () => {
    const run = recordTake(startRun('water'), {
      transcript: 'done',
      uri: 'file:///take.wav',
      route: glassesRoute,
    })

    expect(run.takes[0]).toMatchObject({
      promptId: 'cmd-done',
      transcript: 'done',
      environment: 'water',
      throughGlasses: true,
    })
    expect(currentPrompt(run)).toEqual(CAPTURE_SCRIPT[1])
  })

  it('keeps a take the recogniser missed entirely', () => {
    const run = recordTake(startRun('quiet'), { transcript: null, uri: null, route: glassesRoute })

    expect(run.takes).toHaveLength(1)
    expect(run.takes[0]?.transcript).toBeNull()
  })

  it('records that the phone microphone was used, not the glasses', () => {
    const run = recordTake(startRun('quiet'), {
      transcript: 'done',
      uri: null,
      route: phoneRoute,
    })

    expect(run.takes[0]?.throughGlasses).toBe(false)
  })

  it('redoes the last take', () => {
    const once = recordTake(startRun('quiet'), { transcript: 'done', uri: null, route: null })
    const undone = redoLast(once)

    expect(undone.takes).toHaveLength(0)
    expect(currentPrompt(undone)).toEqual(CAPTURE_SCRIPT[0])
    expect(redoLast(startRun('quiet')).index).toBe(0)
  })

  it('completes after the last prompt', () => {
    const run = CAPTURE_SCRIPT.reduce(
      (current) => recordTake(current, { transcript: 'done', uri: null, route: null }),
      startRun('quiet'),
    )

    expect(isComplete(run)).toBe(true)
    expect(currentPrompt(run)).toBeNull()
  })
})

describe('scoreTake', () => {
  it('counts a command heard correctly', () => {
    expect(scoreTake(take({ transcript: 'done' }))).toBe('correct')
    expect(scoreTake(take({ transcript: 'Done.' }))).toBe('correct')
  })

  it('counts a command heard as a different command', () => {
    expect(scoreTake(take({ transcript: 'stop' }))).toBe('wrong')
  })

  it('counts a command the recogniser did not produce usable words for', () => {
    expect(scoreTake(take({ transcript: null }))).toBe('missed')
    expect(scoreTake(take({ transcript: 'dunn' }))).toBe('missed')
  })

  it('calls out a command taken from an utterance that was not one', () => {
    const negative = take({ purpose: 'negative', expect: null, say: "I'm not done yet" })

    expect(scoreTake({ ...negative, transcript: "I'm not done yet" })).toBe('correct')
    expect(scoreTake({ ...negative, transcript: 'done' })).toBe('falseAccept')
  })

  it('treats silence on a negative as the right answer', () => {
    expect(scoreTake(take({ expect: null, transcript: null }))).toBe('correct')
  })

  it('scores a spoken name as browsing', () => {
    const name = take({ purpose: 'name', expect: 'browse', say: 'Start make coffee' })

    expect(scoreTake({ ...name, transcript: 'start make coffee' })).toBe('correct')
    expect(scoreTake({ ...name, transcript: 'start' })).toBe('missed')
  })
})

describe('summarise', () => {
  it('counts outcomes and how many came through the glasses', () => {
    const summary = summarise([
      take({ transcript: 'done' }),
      take({ transcript: 'stop' }),
      take({ transcript: null }),
      take({ expect: null, transcript: 'done', throughGlasses: false }),
    ])

    expect(summary).toEqual({
      total: 4,
      correct: 1,
      wrong: 1,
      missed: 1,
      falseAccepts: 1,
      throughGlasses: 3,
    })
  })
})
