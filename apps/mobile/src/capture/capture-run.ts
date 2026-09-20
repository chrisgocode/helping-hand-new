import type { AudioRouteDescription } from '../../modules/audio-route'
import { recognizeBrowseIntent } from '../session/browse-intent'
import type { BrowseIntent } from '../session/browse-navigation'
import { recognizeIntent } from '../session/session-intent'
import { matchByName } from '../session/spoken-match'
import { isCapturingThroughBluetoothMic } from '../voice/audio-route'
import {
  CAPTURE_SCRIPT,
  type CaptureEnvironmentId,
  type CapturePrompt,
  SAMPLE_NAMES,
} from './capture-script'

/** One prompt, as it was actually spoken and heard. */
export type CaptureTake = {
  readonly promptId: string
  readonly say: string
  readonly purpose: CapturePrompt['purpose']
  readonly expect: CapturePrompt['expect']
  readonly environment: CaptureEnvironmentId
  /** What the on-device recogniser heard, or null when it heard nothing. */
  readonly transcript: string | null
  /** Where the audio was written, for replaying against other recognisers. */
  readonly uri: string | null
  /**
   * Whether a Bluetooth hands-free microphone was the input when this was
   * recorded. The route cannot identify the headset, so this does not say the
   * glasses: a take still has to be read alongside the route description.
   */
  readonly throughBluetoothMic: boolean
  /**
   * The recogniser's error code, when it failed rather than simply hearing
   * nothing. The two are indistinguishable from an empty transcript alone, and
   * they mean opposite things about whether voice control is viable.
   */
  readonly error: string | null
  readonly recordedAt: string
}

/**
 * Something that happened to the audio session during a run, rather than during
 * one take. A pair of glasses that disconnects, or a call that interrupts
 * recognition, explains a stretch of poor results that would otherwise read as
 * the microphone being bad.
 */
export type CaptureEvent =
  | {
      readonly kind: 'routeChange'
      readonly at: string
      readonly reason: string
      readonly description: string
      readonly throughBluetoothMic: boolean
    }
  | { readonly kind: 'interruption'; readonly at: string; readonly began: boolean }

export type CaptureRun = {
  readonly environment: CaptureEnvironmentId
  readonly prompts: readonly CapturePrompt[]
  readonly index: number
  readonly takes: readonly CaptureTake[]
  readonly events: readonly CaptureEvent[]
}

export function startRun(environment: CaptureEnvironmentId): CaptureRun {
  return { environment, prompts: CAPTURE_SCRIPT, index: 0, takes: [], events: [] }
}

/**
 * Appends a session event. Events are kept whole rather than folded into the
 * take they interrupted, because the timestamps are what let a run be read back
 * as a sequence afterwards.
 */
export function recordEvent(run: CaptureRun, event: CaptureEvent): CaptureRun {
  return { ...run, events: [...run.events, event] }
}

export function currentPrompt(run: CaptureRun): CapturePrompt | null {
  return run.prompts[run.index] ?? null
}

export function isComplete(run: CaptureRun): boolean {
  return run.index >= run.prompts.length
}

/**
 * Records what was heard for the current prompt and moves on.
 *
 * A take is kept even when nothing was recognised. A prompt the recogniser
 * missed entirely is the most interesting result in the set, and dropping it
 * would quietly inflate every accuracy number computed later.
 */
export function recordTake(
  run: CaptureRun,
  heard: {
    transcript: string | null
    uri: string | null
    route: AudioRouteDescription | null
    error?: string | null
  },
): CaptureRun {
  const prompt = currentPrompt(run)
  if (!prompt) return run

  const take: CaptureTake = {
    promptId: prompt.id,
    say: prompt.say,
    purpose: prompt.purpose,
    expect: prompt.expect,
    environment: run.environment,
    transcript: heard.transcript,
    uri: heard.uri,
    throughBluetoothMic: heard.route ? isCapturingThroughBluetoothMic(heard.route) : false,
    error: heard.error ?? null,
    recordedAt: new Date().toISOString(),
  }

  return { ...run, index: run.index + 1, takes: [...run.takes, take] }
}

/**
 * Steps back so a take spoiled by a cough or a misread prompt can be redone.
 * Events are left alone: a disconnect still happened, whatever became of the
 * take that ran into it.
 */
export function redoLast(run: CaptureRun): CaptureRun {
  if (run.takes.length === 0) return run

  return { ...run, index: run.index - 1, takes: run.takes.slice(0, -1) }
}

export type TakeOutcome = 'correct' | 'wrong' | 'missed' | 'falseAccept' | 'error'

/**
 * Scores one take against what the prompt expected.
 *
 * This is the same recognition the app itself would do, run over what the device
 * actually heard, so the number reflects the whole path rather than the
 * recogniser alone. `falseAccept` is called out separately because taking a
 * command that was never given is the failure that costs a recipient a task.
 */
export function scoreTake(take: CaptureTake): TakeOutcome {
  // A failed recogniser is not evidence about speech, so it is never scored as
  // a hit or a miss. Counting it either way would describe the harness rather
  // than the microphone.
  if (take.error !== null) return 'error'
  if (take.transcript === null) return take.expect === null ? 'correct' : 'missed'

  const traversal = recognizeIntent(take.transcript)
  const browsing = traversal ? null : recognizeBrowseIntent(take.transcript)

  if (take.expect === null) {
    return traversal === null && browsing === null ? 'correct' : 'falseAccept'
  }

  if (typeof take.expect === 'string') {
    if (traversal === null) return browsing === null ? 'missed' : 'wrong'
    return traversal === take.expect ? 'correct' : 'wrong'
  }

  if (browsing === null) return traversal === null ? 'missed' : 'wrong'

  return sameBrowseTarget(take.expect, browsing) ? 'correct' : 'wrong'
}

/**
 * Whether a browsing request asked for the thing the prompt asked for.
 *
 * The spoken name is resolved the same way the app resolves it, rather than
 * compared as text, so the score covers the whole path a recipient's words take
 * and tolerates the wording the recogniser actually returns. A name that
 * resolves to nothing is never a match: the manifest is there to show that
 * "morning routine" and "morning walk" can be told apart, so anything short of
 * landing on the right one is a miss.
 */
function sameBrowseTarget(expected: BrowseIntent, heard: BrowseIntent): boolean {
  if (expected.kind !== heard.kind) return false
  if (!('spoken' in expected) || !('spoken' in heard)) return true

  const wanted = matchByName(SAMPLE_NAMES, expected.spoken, (name) => name)

  return wanted !== null && wanted === matchByName(SAMPLE_NAMES, heard.spoken, (name) => name)
}

export type CaptureSummary = {
  readonly total: number
  readonly correct: number
  readonly wrong: number
  readonly missed: number
  readonly falseAccepts: number
  readonly errors: number
  readonly throughBluetoothMic: number
}

/** A count the tester can read back over the phone without exporting anything. */
export function summarise(takes: readonly CaptureTake[]): CaptureSummary {
  const outcomes = takes.map(scoreTake)

  return {
    total: takes.length,
    correct: outcomes.filter((outcome) => outcome === 'correct').length,
    wrong: outcomes.filter((outcome) => outcome === 'wrong').length,
    missed: outcomes.filter((outcome) => outcome === 'missed').length,
    falseAccepts: outcomes.filter((outcome) => outcome === 'falseAccept').length,
    errors: outcomes.filter((outcome) => outcome === 'error').length,
    throughBluetoothMic: takes.filter((take) => take.throughBluetoothMic).length,
  }
}
