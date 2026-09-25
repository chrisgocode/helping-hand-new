import type { AudioRouteDescription } from '../../modules/audio-route'
import { describeRoute } from '../voice/audio-route'
import { type CaptureRun, type CaptureSummary, scoreTake, summarise } from './capture-run'

export type CaptureManifest = {
  readonly version: 1
  readonly createdAt: string
  readonly device: string
  readonly route: {
    readonly description: string
    readonly raw: AudioRouteDescription | null
  }
  readonly summary: CaptureSummary
  readonly takes: readonly (CaptureRun['takes'][number] & { readonly outcome: string })[]
  /** Route changes and interruptions, in the order they happened. */
  readonly events: CaptureRun['events']
}

/**
 * Describes a capture run as a single file.
 *
 * The manifest carries the scored outcome alongside the raw transcript so the
 * set can be read without this app present, and the audio paths so it can be
 * replayed against a different recogniser later. The route is recorded because a
 * set captured through the phone microphone proves nothing about the glasses and
 * must be discarded rather than averaged in.
 */
export function buildManifest(
  run: CaptureRun,
  context: { device: string; route: AudioRouteDescription | null; now?: Date },
): CaptureManifest {
  return {
    version: 1,
    createdAt: (context.now ?? new Date()).toISOString(),
    device: context.device,
    route: {
      description: context.route ? describeRoute(context.route) : 'Unknown',
      raw: context.route,
    },
    summary: summarise(run.takes),
    takes: run.takes.map((take) => ({ ...take, outcome: scoreTake(take) })),
    events: run.events,
  }
}

/** A file name that sorts by time and says what it holds. */
export function manifestFileName(run: CaptureRun, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `helping-hand-capture-${run.environment}-${stamp}.json`
}
