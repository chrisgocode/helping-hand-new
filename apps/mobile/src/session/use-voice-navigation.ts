import type { RecipientTaskTree } from '@helping-hand/schemas'
import { useCallback, useMemo, useState } from 'react'
import type { VoiceInterface } from '../voice/voice-interface'
import { recognizeBrowseIntent } from './browse-intent'
import { narrateBrowse } from './browse-narration'
import {
  type BrowseIntent,
  type BrowsePosition,
  type BrowseTransition,
  browse,
} from './browse-navigation'
import { recognizeIntent } from './session-intent'
import { buildCatalog, type CatalogCategory } from './task-catalog'
import { useGuidedSession } from './use-guided-session'

/**
 * What became of something the recipient said. `unrecognised` is the escalation
 * point: everything the device can answer by itself has already been tried.
 */
export type HeardResult = 'browsed' | 'traversed' | 'unrecognised'

export type VoiceNavigation = {
  readonly catalog: readonly CatalogCategory[]
  readonly position: BrowsePosition
  readonly session: ReturnType<typeof useGuidedSession>
  readonly isRunning: boolean
  request(intent: BrowseIntent): Promise<void>
  hear(transcript: string): Promise<HeardResult>
}

/**
 * Drives the whole spoken experience: moving around what has been assigned, and
 * running one of it.
 *
 * A transcript is offered to the running session first and to the catalog
 * second. A recipient mid-routine saying "next" means the next task, not a
 * search for a routine called "next", and traversal commands are a closed set
 * that cannot collide with a caretaker's names.
 */
export function useVoiceNavigation(
  voice: VoiceInterface,
  trees: readonly RecipientTaskTree[],
): VoiceNavigation {
  const catalog = useMemo(() => buildCatalog(trees), [trees])
  const [position, setPosition] = useState<BrowsePosition>({ kind: 'catalog' })
  const session = useGuidedSession(voice)
  const isRunning = session.task !== null

  const apply = useCallback(
    async ({ position: next, effect }: BrowseTransition) => {
      setPosition(next)

      if (effect.kind === 'starting') {
        // The routine announces itself, so the only line spoken here is the one
        // that would otherwise leave a silence before it begins.
        await voice.speak(narrateBrowse(effect))
        await session.start(effect.routine)
        return
      }

      await voice.speak(narrateBrowse(effect))
    },
    [voice, session],
  )

  const request = useCallback(
    async (intent: BrowseIntent) => {
      await apply(browse(catalog, position, intent))
    },
    [apply, catalog, position],
  )

  const hear = useCallback(
    async (transcript: string) => {
      if (isRunning) {
        const traversal = recognizeIntent(transcript)
        if (traversal) {
          await session.submit(traversal)
          return 'traversed'
        }
      }

      const browsing = recognizeBrowseIntent(transcript)
      if (!browsing) return 'unrecognised'

      await request(browsing)
      return 'browsed'
    },
    [isRunning, session, request],
  )

  return { catalog, position, session, isRunning, request, hear }
}
