import * as Speech from 'expo-speech'
import { type RecognitionRun, runRecognition } from './recognition-run'
import type { VoiceInterface } from './voice-interface'

const RECOVERABLE_RECOGNITION_ERRORS = new Set([
  'aborted',
  'audio-capture',
  'busy',
  'interrupted',
  'no-speech',
  'speech-timeout',
])

// Bluetooth output can still have a small buffered tail when narration reports
// completion. Keep this visible for hardware tuning if a route needs more time.
const NARRATION_TAIL_GRACE_MS = 250
const RECOGNITION_RETRY_DELAY_MS = 250

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * Speaks through whichever output the app's audio session is routed to, which
 * is the phone speaker until a Bluetooth route is established and the glasses
 * take over. Routing is deliberately not configured here: `speak` leaves
 * `useApplicationAudioSession` at its default so the app's own session governs
 * the route, rather than expo-speech opening a session of its own.
 */
export function createExpoSpeechVoice(): VoiceInterface {
  let recognition: RecognitionRun | null = null
  let interruption = 0
  let speaking: Promise<void> = Promise.resolve()
  const preferredEnglishVoice = Speech.getAvailableVoicesAsync()
    .then(
      (voices) =>
        voices.find(
          (voice) => voice.quality === Speech.VoiceQuality.Premium && voice.language === 'en-US',
        )?.identifier ??
        voices.find(
          (voice) =>
            voice.quality === Speech.VoiceQuality.Premium && voice.language.startsWith('en-'),
        )?.identifier ??
        voices.find(
          (voice) => voice.quality === Speech.VoiceQuality.Enhanced && voice.language === 'en-US',
        )?.identifier ??
        voices.find(
          (voice) =>
            voice.quality === Speech.VoiceQuality.Enhanced && voice.language.startsWith('en-'),
        )?.identifier,
    )
    .catch(() => undefined)

  // expo-speech queues an utterance when one is already in progress, and
  // resolves nothing on its own, so both interface guarantees are built here.
  const say = async (text: string) => {
    const voice = await preferredEnglishVoice

    return new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        language: 'en-US',
        voice,
        onDone: () => resolve(),
        // A replaced utterance is the expected case, not a failure: the session
        // has already moved on and is about to speak the line that replaced it.
        onStopped: () => resolve(),
        onError: (error) => reject(error),
      })
    })
  }

  const abortRecognition = () => {
    recognition?.cancel()
    recognition = null
  }

  const waitForSpeech = async () => {
    let current: Promise<void>
    do {
      current = speaking
      await current
    } while (current !== speaking)
  }

  return {
    async speak(text) {
      interruption += 1
      const task = (async () => {
        abortRecognition()
        await Speech.stop()
        await say(text)
        await wait(NARRATION_TAIL_GRACE_MS)
      })()
      speaking = task.catch(() => {})
      await task
    },

    async listen(contextualStrings) {
      const startedDuring = interruption
      await waitForSpeech()
      if (startedDuring !== interruption) return null

      const run = runRecognition({ contextualStrings })
      recognition = run

      try {
        const heard = await run.result
        if (heard.error && !RECOVERABLE_RECOGNITION_ERRORS.has(heard.error)) {
          throw new Error('Voice recognition stopped. Tap voice controls to try again.')
        }

        if (heard.error) {
          await wait(RECOGNITION_RETRY_DELAY_MS)
          return null
        }

        return heard.transcript
      } finally {
        if (recognition === run) recognition = null
      }
    },

    async stop() {
      interruption += 1
      abortRecognition()
      await Speech.stop()
    },
  }
}
