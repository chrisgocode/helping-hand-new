import {
  type ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
  type RecordingOptions,
} from 'expo-speech-recognition'
import AudioRoute from '../../modules/audio-route'
import { handsFreeCategory, openHandsFreeRoute } from './hands-free-route'

export type RecognitionResult = {
  readonly transcript: string | null
  readonly uri: string | null
  readonly error: ExpoSpeechRecognitionErrorCode | null
}

export type RecognitionRun = {
  readonly result: Promise<RecognitionResult>
  /** Requests a final transcript and recording, then ends the run. */
  finish(): void
  /** Aborts without a final result and releases the audio session. */
  cancel(): void
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/** Runs one on-device recognition lifecycle through the hands-free route. */
export function runRecognition({
  contextualStrings,
  recordingOptions,
  onStart,
}: {
  readonly contextualStrings: readonly string[]
  readonly recordingOptions?: RecordingOptions
  readonly onStart?: () => void
}): RecognitionRun {
  let active = false
  let cancelled = false
  let finishRequested = false
  let settle: ((result: RecognitionResult) => void) | null = null

  const cancelledResult = (): RecognitionResult => ({
    transcript: null,
    uri: null,
    error: 'aborted',
  })

  const deactivate = () => ExpoSpeechRecognitionModule.setAudioSessionActiveIOS(false)

  const result = (async (): Promise<RecognitionResult> => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      throw new Error('Voice recognition is not available on this device.')
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!permission.granted) {
      throw new Error('Microphone and speech recognition access are required for voice controls.')
    }
    if (cancelled) return cancelledResult()

    await openHandsFreeRoute({
      setCategory: () => ExpoSpeechRecognitionModule.setCategoryIOS(handsFreeCategory()),
      activate: () => ExpoSpeechRecognitionModule.setAudioSessionActiveIOS(true),
      getRoute: () => AudioRoute.getCurrentRoute(),
      wait,
    })
    if (cancelled) {
      deactivate()
      return cancelledResult()
    }

    return new Promise<RecognitionResult>((resolve, reject) => {
      let transcript: string | null = null
      let uri: string | null = null
      let error: ExpoSpeechRecognitionErrorCode | null = null

      const listeners = [
        ExpoSpeechRecognitionModule.addListener('result', (event) => {
          const heard = event.results[0]?.transcript?.trim()
          if (heard) transcript = heard
        }),
        ExpoSpeechRecognitionModule.addListener('audioend', (event) => {
          uri = event.uri ?? null
        }),
        ExpoSpeechRecognitionModule.addListener('error', (event) => {
          error = event.error
        }),
        ExpoSpeechRecognitionModule.addListener('end', () => {
          active = false
          for (const listener of listeners) listener.remove()
          settle = null
          resolve({ transcript, uri, error })
        }),
      ]

      settle = (outcome) => {
        active = false
        for (const listener of listeners) listener.remove()
        settle = null
        resolve(outcome)
      }

      active = true
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
          recordingOptions,
        })
        onStart?.()
        if (finishRequested) ExpoSpeechRecognitionModule.stop()
      } catch (cause) {
        active = false
        for (const listener of listeners) listener.remove()
        settle = null
        deactivate()
        reject(cause)
      }
    })
  })()

  return {
    result,
    finish() {
      finishRequested = true
      if (active) ExpoSpeechRecognitionModule.stop()
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      const wasActive = active
      settle?.(cancelledResult())
      if (wasActive) ExpoSpeechRecognitionModule.abort()
      deactivate()
    },
  }
}
