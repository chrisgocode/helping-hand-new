import type { SessionIntent } from './guided-session'

/**
 * The spoken phrases that map to a traversal intent. Everything else is a
 * question for the assistant, so this table is the whole boundary between what
 * the device answers by itself and what needs the network.
 */
const INTENT_PHRASES: Readonly<Record<SessionIntent, readonly string[]>> = {
  next: ['next', 'done', 'finished', 'complete', 'next step', 'im done', 'i am done', 'all done'],
  back: ['back', 'go back', 'previous', 'last one', 'go back a step'],
  repeat: ['repeat', 'again', 'say that again', 'say it again', 'what was that', 'one more time'],
  duration: ['how long', 'how long is this', 'how long should i do that', 'how much time'],
  preview: ['whats next', 'what is next', 'what comes next', 'preview'],
  pause: ['pause', 'hold on', 'wait', 'one moment'],
  resume: ['resume', 'continue', 'carry on', 'keep going'],
  stop: ['stop', 'quit', 'end session', 'im finished', 'i am finished', 'cancel'],
}

/**
 * Leading words a recipient adds without meaning anything by them. Stripped so
 * "okay, next" reaches the same phrase as "next".
 */
const LEADING_FILLER = new Set(['okay', 'ok', 'um', 'uh', 'so', 'and', 'well', 'yeah', 'alright'])

const TRAILING_FILLER = new Set(['please', 'thanks', 'now'])

const PHRASE_LOOKUP: ReadonlyMap<string, SessionIntent> = new Map(
  Object.entries(INTENT_PHRASES).flatMap(([intent, phrases]) =>
    phrases.map((phrase) => [phrase, intent as SessionIntent] as const),
  ),
)

/**
 * Every command phrase, for biasing a speech recognizer toward them. The glasses
 * microphone is narrowband and beamformed, so the recognizer needs the help.
 */
export const COMMAND_PHRASES: readonly string[] = [...PHRASE_LOOKUP.keys()]

/**
 * Maps a transcript to a traversal intent, or null when it is not a command.
 *
 * Matching is whole-utterance, never substring: a false "next" skips an action
 * the recipient has not performed, and "I'm not done yet" contains "done". The
 * cost of being strict is an occasional unrecognized command, which is
 * recoverable by repeating it; the cost of being loose is not.
 */
export function recognizeIntent(transcript: string): SessionIntent | null {
  const normalized = normalize(transcript)
  if (!normalized) return null

  return PHRASE_LOOKUP.get(normalized) ?? null
}

function normalize(transcript: string): string {
  const words = transcript
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  let start = 0
  while (start < words.length && LEADING_FILLER.has(words[start] as string)) start += 1

  let end = words.length
  while (end > start && TRAILING_FILLER.has(words[end - 1] as string)) end -= 1

  return words.slice(start, end).join(' ')
}
