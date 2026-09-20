import type { BrowseIntent } from '../session/browse-navigation'
import type { SessionIntent } from '../session/guided-session'

/**
 * The names a tester is asked to say. They stand in for what a caretaker would
 * write, because the tester has nothing assigned to them. They are deliberately
 * ordinary, with one overlapping pair ("Morning routine" and "Morning walk") to
 * show whether near-identical names can be told apart over a narrowband
 * microphone.
 */
export const SAMPLE_NAMES = [
  'Kitchen',
  'Bathroom',
  'Morning routine',
  'Morning walk',
  'Make coffee',
  'Take medication',
] as const

export type CapturePurpose = 'command' | 'negative' | 'name' | 'freeform'

export type CapturePrompt = {
  readonly id: string
  /** What the tester is asked to say, word for word. */
  readonly say: string
  readonly purpose: CapturePurpose
  /**
   * What recognition should resolve to. `null` means the utterance must not be
   * taken as a command: a false accept skips a task the recipient has not done.
   *
   * A browsing prompt carries the whole intent rather than the word "browse",
   * because the interesting question about a spoken name is whether the right
   * one was resolved. Scoring the kind alone marks "start morning walk" correct
   * against a prompt that asked for the morning routine, which is the exact
   * confusion the overlapping sample names exist to measure.
   */
  readonly expect: SessionIntent | BrowseIntent | null
}

/**
 * What a tester is asked to say, in the order it is asked.
 *
 * Commands come first because they are the cheapest to score and the most
 * load-bearing. Negatives are placed among them rather than at the end, where a
 * tired tester rushes.
 */
export const CAPTURE_SCRIPT: readonly CapturePrompt[] = [
  { id: 'cmd-done', say: 'Done', purpose: 'command', expect: 'next' },
  { id: 'cmd-next', say: 'Next', purpose: 'command', expect: 'next' },
  { id: 'neg-not-done', say: "I'm not done yet", purpose: 'negative', expect: null },
  { id: 'cmd-repeat', say: 'Repeat', purpose: 'command', expect: 'repeat' },
  { id: 'cmd-again', say: 'Say that again', purpose: 'command', expect: 'repeat' },
  { id: 'cmd-back', say: 'Go back', purpose: 'command', expect: 'back' },
  {
    id: 'neg-back-sentence',
    say: 'Can I go back to the kitchen later',
    purpose: 'negative',
    expect: null,
  },
  { id: 'cmd-how-long', say: 'How long', purpose: 'command', expect: 'duration' },
  { id: 'cmd-whats-next', say: "What's next", purpose: 'command', expect: 'preview' },
  { id: 'cmd-pause', say: 'Hold on', purpose: 'command', expect: 'pause' },
  { id: 'cmd-resume', say: 'Keep going', purpose: 'command', expect: 'resume' },
  { id: 'cmd-stop', say: 'Stop', purpose: 'command', expect: 'stop' },
  {
    id: 'neg-stop-sentence',
    say: 'I had to stop at the shop on the way',
    purpose: 'negative',
    expect: null,
  },
  {
    id: 'name-categories',
    say: 'List my categories',
    purpose: 'name',
    expect: { kind: 'listCategories' },
  },
  {
    id: 'name-list-kitchen',
    say: 'List tasks from Kitchen',
    purpose: 'name',
    expect: { kind: 'listRoutines', spoken: 'Kitchen' },
  },
  {
    id: 'name-start-coffee',
    say: 'Start make coffee',
    purpose: 'name',
    expect: { kind: 'start', spoken: 'Make coffee' },
  },
  {
    id: 'name-start-morning-routine',
    say: 'Start morning routine',
    purpose: 'name',
    expect: { kind: 'start', spoken: 'Morning routine' },
  },
  {
    id: 'name-start-morning-walk',
    say: 'Start morning walk',
    purpose: 'name',
    expect: { kind: 'start', spoken: 'Morning walk' },
  },
  {
    id: 'name-start-medication',
    say: 'Start take medication',
    purpose: 'name',
    expect: { kind: 'start', spoken: 'Take medication' },
  },
  {
    id: 'free-confused',
    say: "I don't understand what this step means",
    purpose: 'freeform',
    expect: null,
  },
  { id: 'free-question', say: 'How much water should I use', purpose: 'freeform', expect: null },
] as const

/**
 * Where a set is recorded. The same script is read in each, because the
 * interesting number is not accuracy on its own but how far it falls when a tap
 * is running — which is when a recipient is most likely to be using their hands.
 */
export const CAPTURE_ENVIRONMENTS = [
  { id: 'quiet', label: 'Quiet room' },
  { id: 'water', label: 'Water running' },
  { id: 'speech', label: 'Television or conversation nearby' },
] as const

export type CaptureEnvironmentId = (typeof CAPTURE_ENVIRONMENTS)[number]['id']
