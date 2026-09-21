import { describe, expect, it } from 'vitest'
import type { CatalogCategory } from './task-catalog'
import { recognizeUtterance } from './utterance-recognition'

const catalog: CatalogCategory[] = [{ id: 'kitchen', name: 'Kitchen', routines: [] }]

describe('recognizeUtterance', () => {
  it('makes command precedence explicit', () => {
    expect(recognizeUtterance('stop helping hand', { catalog, isRunning: true })).toEqual({
      kind: 'stopVoice',
    })
    expect(recognizeUtterance('cancel', { catalog, isRunning: true })).toEqual({
      kind: 'traversal',
      intent: 'stop',
    })
    expect(recognizeUtterance('cancel', { catalog, isRunning: false })).toEqual({
      kind: 'browse',
      intent: { kind: 'back' },
    })
    expect(recognizeUtterance('kitchen', { catalog, isRunning: false })).toEqual({
      kind: 'browse',
      intent: { kind: 'listRoutines', spoken: 'kitchen' },
    })
  })
})
