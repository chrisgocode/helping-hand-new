import * as Speech from 'expo-speech'
import {
  type ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionModule,
} from 'expo-speech-recognition'
import AudioRoute from '../../modules/audio-route'
import { handsFreeCategory, openHandsFreeRoute } from './hands-free-route'
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
  let permissionsGranted = false
  let recognitionActive = false
  let interruption = 0
  let speaking: Promise<void> = Promise.resolve()
  const enhancedEnglishVoice = Speech.getAvailableVoicesAsync()
    .then(
      (voices) =>
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
    const voice = await enhancedEnglishVoice

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
    if (recognitionActive) ExpoSpeechRecognitionModule.abort()
  }

  const waitForSpeech = async () => {
    let current: Promise<void>
    do {
      current = speaking
      await current
    } while (current !== speaking)
  }

  const prepareToListen = async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      throw new Error('Voice recognition is not available on this device.')
    }

    if (!permissionsGranted) {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permission.granted) {
        throw new Error('Microphone and speech recognition access are required for voice controls.')
      }
      permissionsGranted = true
    }

    await openHandsFreeRoute({
      setCategory: () => ExpoSpeechRecognitionModule.setCategoryIOS(handsFreeCategory()),
      activate: () => ExpoSpeechRecognitionModule.setAudioSessionActiveIOS(true),
      getRoute: () => AudioRoute.getCurrentRoute(),
      wait,
    })
  }

  const recognize = (contextualStrings: readonly string[]) =>
    new Promise<string | null>((resolve, reject) => {
      let transcript: string | null = null
      let error: ExpoSpeechRecognitionErrorEvent | null = null

      const result = ExpoSpeechRecognitionModule.addListener('result', (event) => {
        const heard = event.results[0]?.transcript?.trim()
        if (heard) transcript = heard
      })
      const failed = ExpoSpeechRecognitionModule.addListener('error', (event) => {
        error = event
      })
      const ended = ExpoSpeechRecognitionModule.addListener('end', () => {
        recognitionActive = false
        result.remove()
        failed.remove()
        ended.remove()

        if (error && !RECOVERABLE_RECOGNITION_ERRORS.has(error.error)) {
          reject(new Error('Voice recognition stopped. Tap voice controls to try again.'))
          return
        }

        if (error) {
          setTimeout(() => resolve(null), RECOGNITION_RETRY_DELAY_MS)
          return
        }

        resolve(transcript)
      })

      recognitionActive = true
      try {
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: false,
          continuous: false,
          requiresOnDeviceRecognition: true,
          addsPunctuation: false,
          contextualStrings: [...contextualStrings],
          iosTaskHint: 'confirmation',
          iosCategory: handsFreeCategory(),
        })
      } catch (cause) {
        recognitionActive = false
        result.remove()
        failed.remove()
        ended.remove()
        reject(cause)
      }
    })

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

      await prepareToListen()
      await waitForSpeech()
      if (startedDuring !== interruption) return null

      return recognize(contextualStrings)
    },

    async stop() {
      interruption += 1
      abortRecognition()
      await Speech.stop()
    },
  }
}
