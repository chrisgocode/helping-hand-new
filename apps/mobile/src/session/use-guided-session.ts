import type { TaskNode } from '@helping-hand/schemas'
import { useCallback, useRef, useState } from 'react'
import type { VoiceInterface } from '../voice/voice-interface'
import {
  applyIntent,
  currentTask,
  type GuidedSession,
  type SequencedTask,
  type SessionIntent,
  startSession,
} from './guided-session'
import { narrate } from './session-narration'

export type GuidedSessionController = {
  readonly session: GuidedSession | null
  readonly task: SequencedTask | null
  readonly isSpeaking: boolean
  isRunning(): boolean
  start(root: TaskNode): Promise<void>
  submit(intent: SessionIntent): Promise<void>
  end(): Promise<void>
}

/**
 * Runs a guided session against a voice output.
 *
 * The voice is passed in rather than constructed so tests, the phone speaker and
 * the glasses all cross the same seam. Traversal stays pure: this hook only
 * holds the current session and speaks what each transition asks for.
 */
export function useGuidedSession(voice: VoiceInterface): GuidedSessionController {
  const [session, setSession] = useState<GuidedSession | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  // Commands can arrive while a line is still being spoken, so the latest
  // session is read from a ref rather than from a state value a caller may be
  // holding from before the previous transition.
  const latest = useRef<GuidedSession | null>(null)

  const commit = useCallback(
    async (next: GuidedSession, line: string | null) => {
      latest.current = next
      setSession(next)

      if (line === null) return

      setIsSpeaking(true)
      try {
        await voice.speak(line)
      } finally {
        setIsSpeaking(false)
      }
    },
    [voice],
  )

  const start = useCallback(
    async (root: TaskNode) => {
      const { session: next, effect } = startSession(root)
      await commit(next, narrate(effect))
    },
    [commit],
  )

  const submit = useCallback(
    async (intent: SessionIntent) => {
      const current = latest.current
      if (!current) return

      const { session: next, effect } = applyIntent(current, intent)
      await commit(next, narrate(effect))
    },
    [commit],
  )

  const end = useCallback(async () => {
    if (latest.current) await submit('stop')
    await voice.stop()
  }, [submit, voice])

  return {
    session,
    task: session ? currentTask(session) : null,
    isSpeaking,
    isRunning: () => latest.current !== null && currentTask(latest.current) !== null,
    start,
    submit,
    end,
  }
}
