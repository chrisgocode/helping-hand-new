import { describe, expect, it } from 'vitest'
import { normalizeName, normalizeUtterance } from './transcript-text'

describe('transcript text', () => {
  it('normalizes commands and names for their different jobs', () => {
    expect(normalizeUtterance('Okay, list my categories please!')).toBe('list my categories')
    expect(normalizeName('My Morning Routine')).toBe('morning')
  })
})
