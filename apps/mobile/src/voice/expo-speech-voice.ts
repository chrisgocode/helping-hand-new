import * as Speech from 'expo-speech'
import type { VoiceInterface } from './voice-interface'

/**
 * Speaks through whichever output the app's audio session is routed to, which
 * is the phone speaker until a Bluetooth route is established and the glasses
 * take over. Routing is deliberately not configured here: `speak` leaves
 * `useApplicationAudioSession` at its default so the app's own session governs
 * the route, rather than expo-speech opening a session of its own.
 */
export function createExpoSpeechVoice(): VoiceInterface {
  // expo-speech queues an utterance when one is already in progress, and
  // resolves nothing on its own, so both interface guarantees are built here.
  const speak = (text: string) =>
    new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        onDone: () => resolve(),
        // A replaced utterance is the expected case, not a failure: the session
        // has already moved on and is about to speak the line that replaced it.
        onStopped: () => resolve(),
        onError: (error) => reject(error),
      })
    })

  return {
    async speak(text) {
      await Speech.stop()
      await speak(text)
    },

    async stop() {
      await Speech.stop()
    },
  }
}
