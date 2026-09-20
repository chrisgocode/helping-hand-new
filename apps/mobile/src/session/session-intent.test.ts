import { describe, expect, it } from 'vitest'
import { COMMAND_PHRASES, recognizeIntent } from './session-intent'

describe('recognizeIntent', () => {
  it('maps spoken phrases to traversal intents', () => {
    expect(recognizeIntent('done')).toBe('next')
    expect(recognizeIntent('go back')).toBe('back')
    expect(recognizeIntent('say that again')).toBe('repeat')
    expect(recognizeIntent('how long')).toBe('duration')
    expect(recognizeIntent("what's next")).toBe('preview')
    expect(recognizeIntent('hold on')).toBe('pause')
    expect(recognizeIntent('keep going')).toBe('resume')
    expect(recognizeIntent('end session')).toBe('stop')
  })

  it('ignores casing, punctuation and apostrophes', () => {
    expect(recognizeIntent('  Done! ')).toBe('next')
    expect(recognizeIntent('I’m done')).toBe('next')
    expect(recognizeIntent("I'm done")).toBe('next')
  })

  it('tolerates filler around the command', () => {
    expect(recognizeIntent('okay next')).toBe('next')
    expect(recognizeIntent('um, repeat please')).toBe('repeat')
    expect(recognizeIntent('alright done now')).toBe('next')
  })

  it('does not match a command buried in a sentence', () => {
    expect(recognizeIntent("I'm not done yet")).toBeNull()
    expect(recognizeIntent('what does next mean')).toBeNull()
    expect(recognizeIntent('can you wait for me to find the toothbrush')).toBeNull()
  })

  it('returns null for questions that belong to the assistant', () => {
    expect(recognizeIntent('I do not understand what this step means')).toBeNull()
    expect(recognizeIntent('')).toBeNull()
    expect(recognizeIntent('   ')).toBeNull()
  })

  it('exposes every phrase for recognizer biasing', () => {
    expect(COMMAND_PHRASES).toContain('done')
    expect(COMMAND_PHRASES).toContain('go back')
    expect(new Set(COMMAND_PHRASES).size).toBe(COMMAND_PHRASES.length)
  })
})
