import type { AudioRouteDescription } from '../../modules/audio-route'
import { recognizeBrowseIntent } from '../session/browse-intent'
import { recognizeIntent } from '../session/session-intent'
import { isCapturingThroughGlasses } from '../voice/audio-route'
import { CAPTURE_SCRIPT, type CaptureEnvironmentId, type CapturePrompt } from './capture-script'

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
  /** Whether the glasses microphone was the input when this was recorded. */
  readonly throughGlasses: boolean
  /**
   * The recogniser's error code, when it failed rather than simply hearing
   * nothing. The two are indistinguishable from an empty transcript alone, and
   * they mean opposite things about whether voice control is viable.
   */
  readonly error: string | null
  readonly recordedAt: string
}

export type CaptureRun = {
  readonly environment: CaptureEnvironmentId
  readonly prompts: readonly CapturePrompt[]
  readonly index: number
  readonly takes: readonly CaptureTake[]
}

export function startRun(environment: CaptureEnvironmentId): CaptureRun {
  return { environment, prompts: CAPTURE_SCRIPT, index: 0, takes: [] }
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
    throughGlasses: heard.route ? isCapturingThroughGlasses(heard.route) : false,
    error: heard.error ?? null,
    recordedAt: new Date().toISOString(),
  }

  return { ...run, index: run.index + 1, takes: [...run.takes, take] }
}

/** Steps back so a take spoiled by a cough or a misread prompt can be redone. */
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
  const resolved = traversal ?? (browsing ? 'browse' : null)

  if (take.expect === null) return resolved === null ? 'correct' : 'falseAccept'
  if (resolved === null) return 'missed'

  return resolved === take.expect ? 'correct' : 'wrong'
}

export type CaptureSummary = {
  readonly total: number
  readonly correct: number
  readonly wrong: number
  readonly missed: number
  readonly falseAccepts: number
  readonly errors: number
  readonly throughGlasses: number
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
    throughGlasses: takes.filter((take) => take.throughGlasses).length,
  }
}
