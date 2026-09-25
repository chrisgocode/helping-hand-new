import { describe, expect, it } from 'vitest'
import { recognizeBrowseIntent } from './browse-intent'

describe('recognizeBrowseIntent', () => {
  it('recognises a request for the category list', () => {
    for (const phrase of ['categories', 'list my categories', 'what can I do?', 'my categories']) {
      expect(recognizeBrowseIntent(phrase)).toEqual({ kind: 'listCategories' })
    }
  })

  it('takes the category name out of a listing request', () => {
    expect(recognizeBrowseIntent('list tasks from kitchen')).toEqual({
      kind: 'listRoutines',
      spoken: 'kitchen',
    })
    expect(recognizeBrowseIntent("what's in the bathroom")).toEqual({
      kind: 'listRoutines',
      spoken: 'the bathroom',
    })
    expect(recognizeBrowseIntent('open kitchen')).toEqual({
      kind: 'listRoutines',
      spoken: 'kitchen',
    })
  })

  it('takes the routine name out of a start request', () => {
    expect(recognizeBrowseIntent('start morning routine')).toEqual({
      kind: 'start',
      spoken: 'morning routine',
    })
    expect(recognizeBrowseIntent('begin the kitchen cleanup')).toEqual({
      kind: 'start',
      spoken: 'kitchen cleanup',
    })
    expect(recognizeBrowseIntent('okay, start make coffee')).toEqual({
      kind: 'start',
      spoken: 'make coffee',
    })
  })

  it('prefers starting over listing when a name is given', () => {
    expect(recognizeBrowseIntent('start kitchen')).toEqual({ kind: 'start', spoken: 'kitchen' })
  })

  it('recognises going back', () => {
    for (const phrase of ['back', 'go back', 'never mind', 'cancel']) {
      expect(recognizeBrowseIntent(phrase)).toEqual({ kind: 'back' })
    }
  })

  it('ignores closing politeness', () => {
    expect(recognizeBrowseIntent('list my categories please')).toEqual({ kind: 'listCategories' })
    expect(recognizeBrowseIntent('go back please')).toEqual({ kind: 'back' })
    expect(recognizeBrowseIntent('okay list my categories now thanks')).toEqual({
      kind: 'listCategories',
    })
    expect(recognizeBrowseIntent('start make coffee please')).toEqual({
      kind: 'start',
      spoken: 'make coffee',
    })
  })

  it('is not a browsing request without a name to act on', () => {
    expect(recognizeBrowseIntent('start')).toBeNull()
    expect(recognizeBrowseIntent('open')).toBeNull()
    expect(recognizeBrowseIntent('')).toBeNull()
    expect(recognizeBrowseIntent('what does this mean')).toBeNull()
    expect(recognizeBrowseIntent('please')).toBeNull()
  })
})
