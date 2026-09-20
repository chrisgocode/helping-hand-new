import type { RecipientTaskTree } from '@helping-hand/schemas'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VoiceInterface } from '../voice/voice-interface'
import { recognizeBrowseIntent } from './browse-intent'
import { narrateBrowse } from './browse-narration'
import {
  type BrowseIntent,
  type BrowsePosition,
  type BrowseTransition,
  browse,
} from './browse-navigation'
import { COMMAND_PHRASES, stopsVoiceControls } from './session-intent'
import { buildCatalog, type CatalogCategory, catalogPhrases, findCategory } from './task-catalog'
import { useGuidedSession } from './use-guided-session'

/**
 * What became of something the recipient said. `unrecognised` is the escalation
 * point: everything the device can answer by itself has already been tried.
 */
export type HeardResult = 'browsed' | 'stopped' | 'traversed' | 'unrecognised'

export type VoiceNavigation = {
  readonly catalog: readonly CatalogCategory[]
  readonly position: BrowsePosition
  readonly session: ReturnType<typeof useGuidedSession>
  readonly isRunning: boolean
  readonly voiceEnabled: boolean
  readonly isListening: boolean
  readonly voiceError: string | null
  request(intent: BrowseIntent): Promise<void>
  hear(transcript: string): Promise<HeardResult>
  startListening(): void
  stopListening(): Promise<void>
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
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const listeningGeneration = useRef(0)
  const listeningEnabled = useRef(false)
  const session = useGuidedSession(voice)
  const isRunning = session.task !== null
  const contextualStrings = useMemo(
    () => [...COMMAND_PHRASES, ...catalogPhrases(catalog)],
    [catalog],
  )

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

  const stopListening = useCallback(async () => {
    listeningEnabled.current = false
    listeningGeneration.current += 1
    setVoiceEnabled(false)
    setIsListening(false)
    await voice.stop()
  }, [voice])

  const hear = useCallback(
    async (transcript: string) => {
      if (stopsVoiceControls(transcript)) {
        await stopListening()
        await voice.speak('Voice controls are off.')
        return 'stopped'
      }

      if (await session.hear(transcript)) return 'traversed'

      const browsing =
        recognizeBrowseIntent(transcript) ??
        (position.kind === 'catalog' && findCategory(catalog, transcript)
          ? { kind: 'listRoutines' as const, spoken: transcript }
          : null)
      if (!browsing) {
        await voice.speak('I did not understand. Please try again.')
        return 'unrecognised'
      }

      await request(browsing)
      return 'browsed'
    },
    [catalog, position.kind, session, request, stopListening, voice],
  )

  const latestHear = useRef(hear)
  const latestContext = useRef(contextualStrings)
  latestHear.current = hear
  latestContext.current = contextualStrings

  const startListening = useCallback(() => {
    if (listeningEnabled.current) return

    listeningEnabled.current = true
    const generation = ++listeningGeneration.current
    setVoiceEnabled(true)
    setVoiceError(null)

    void (async () => {
      try {
        while (listeningEnabled.current && generation === listeningGeneration.current) {
          setIsListening(true)
          const transcript = await voice.listen(latestContext.current)
          setIsListening(false)

          if (!listeningEnabled.current || generation !== listeningGeneration.current) return
          if (transcript) await latestHear.current(transcript)
        }
      } catch (error) {
        if (generation !== listeningGeneration.current) return

        listeningEnabled.current = false
        setVoiceEnabled(false)
        setIsListening(false)
        setVoiceError(
          error instanceof Error ? error.message : 'Voice recognition stopped. Tap to try again.',
        )
      }
    })()
  }, [voice])

  useEffect(
    () => () => {
      listeningEnabled.current = false
      listeningGeneration.current += 1
      void voice.stop()
    },
    [voice],
  )

  return {
    catalog,
    position,
    session,
    isRunning,
    voiceEnabled,
    isListening,
    voiceError,
    request,
    hear,
    startListening,
    stopListening,
  }
}
