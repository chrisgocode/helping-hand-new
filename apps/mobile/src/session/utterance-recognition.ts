import { recognizeBrowseIntent } from './browse-intent'
import type { SpokenBrowseIntent } from './browse-navigation'
import type { SessionIntent } from './guided-session'
import { recognizeIntent, stopsVoiceControls } from './session-intent'
import { type CatalogCategory, findCategory } from './task-catalog'

export type RecognizedUtterance =
  | { readonly kind: 'stopVoice' }
  | { readonly kind: 'traversal'; readonly intent: SessionIntent }
  | { readonly kind: 'browse'; readonly intent: SpokenBrowseIntent }
  | { readonly kind: 'unrecognised' }

/** Declares the precedence for every phrase the on-device recognizer understands. */
export function recognizeUtterance(
  transcript: string,
  context: { readonly catalog: readonly CatalogCategory[]; readonly isRunning: boolean },
): RecognizedUtterance {
  if (stopsVoiceControls(transcript)) return { kind: 'stopVoice' }

  const traversal = recognizeIntent(transcript)
  if (context.isRunning && traversal) return { kind: 'traversal', intent: traversal }

  const browsing =
    recognizeBrowseIntent(transcript) ??
    (findCategory(context.catalog, transcript)
      ? { kind: 'listRoutines' as const, spoken: transcript }
      : null)

  return browsing ? { kind: 'browse', intent: browsing } : { kind: 'unrecognised' }
}
