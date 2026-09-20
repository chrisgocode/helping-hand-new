import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { useCallback, useRef, useState } from 'react'
import AudioRoute, { type AudioRouteDescription } from '../../modules/audio-route'
import { COMMAND_PHRASES } from '../session/session-intent'
import {
  type CaptureRun,
  currentPrompt,
  isComplete,
  recordTake,
  redoLast,
  startRun,
  summarise,
} from './capture-run'
import { type CaptureEnvironmentId, SAMPLE_NAMES } from './capture-script'

/**
 * Every phrase the recogniser is told to expect. Biasing is part of what is
 * being measured, so the set given here is the same set the app would give in
 * use: the fixed commands, plus the names that stand in for assigned routines.
 */
const CONTEXTUAL_STRINGS = [...COMMAND_PHRASES, ...SAMPLE_NAMES]

export type CaptureController = {
  readonly run: CaptureRun | null
  readonly listening: boolean
  readonly route: AudioRouteDescription | null
  readonly summary: ReturnType<typeof summarise> | null
  begin(environment: CaptureEnvironmentId): void
  listen(): Promise<void>
  finishTake(): void
  redo(): void
  refreshRoute(): void
}

/**
 * Drives one pass through the capture script.
 *
 * Recognition runs on device and writes its audio to a file, so each prompt
 * yields both what this recogniser heard and something to replay against another
 * one later. The route is read at every take rather than once at the start: a
 * pair of glasses that drops mid-run would otherwise leave the rest of the set
 * silently attributed to hardware that was not listening.
 */
export function useCapture(): CaptureController {
  const [run, setRun] = useState<CaptureRun | null>(null)
  const [listening, setListening] = useState(false)
  const [route, setRoute] = useState<AudioRouteDescription | null>(null)
  const heard = useRef<{ transcript: string | null; uri: string | null }>({
    transcript: null,
    uri: null,
  })

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim()
    if (transcript) heard.current.transcript = transcript
  })

  useSpeechRecognitionEvent('audioend', (event) => {
    heard.current.uri = event.uri ?? null
  })

  useSpeechRecognitionEvent('end', () => setListening(false))

  const refreshRoute = useCallback(() => setRoute(AudioRoute.getCurrentRoute()), [])

  const begin = useCallback(
    (environment: CaptureEnvironmentId) => {
      setRun(startRun(environment))
      refreshRoute()
    },
    [refreshRoute],
  )

  const listen = useCallback(async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!permission.granted) return

    heard.current = { transcript: null, uri: null }
    setListening(true)

    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      continuous: false,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
      contextualStrings: CONTEXTUAL_STRINGS,
      iosTaskHint: 'confirmation',
      // The glasses microphone only exists on the hands-free route, so the
      // session has to be in play-and-record with Bluetooth allowed before the
      // recogniser opens it.
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['allowBluetooth', 'defaultToSpeaker'],
        mode: 'measurement',
      },
      recordingOptions: { persist: true },
    })

    // Reading the route after the recogniser has opened the session is the only
    // way to see which microphone it actually got.
    refreshRoute()
  }, [refreshRoute])

  const finishTake = useCallback(() => {
    ExpoSpeechRecognitionModule.stop()
    const current = AudioRoute.getCurrentRoute()
    setRoute(current)

    setRun((existing) =>
      existing ? recordTake(existing, { ...heard.current, route: current }) : existing,
    )
  }, [])

  const redo = useCallback(
    () => setRun((existing) => (existing ? redoLast(existing) : existing)),
    [],
  )

  return {
    run,
    listening,
    route,
    summary: run && isComplete(run) ? summarise(run.takes) : null,
    begin,
    listen,
    finishTake,
    redo,
    refreshRoute,
  }
}

export { currentPrompt, isComplete }
