import { Directory, Paths } from 'expo-file-system'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { useCallback, useEffect, useRef, useState } from 'react'
import AudioRoute, { type AudioRouteDescription } from '../../modules/audio-route'
import { COMMAND_PHRASES } from '../session/session-intent'
import { describeRoute, isCapturingThroughGlasses } from '../voice/audio-route'
import {
  type CaptureRun,
  currentPrompt,
  isComplete,
  recordEvent,
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

/**
 * Recordings and the manifest live together in the documents directory rather
 * than the cache. The cache is purged under storage pressure, which would leave
 * a manifest pointing at audio that no longer exists, and only the documents
 * directory is reachable from the Files app — which is how a tester sends the
 * whole set back without exporting one file at a time.
 */
export const CAPTURE_DIRECTORY = new Directory(Paths.document, 'captures')

function captureDirectory(): Directory {
  if (!CAPTURE_DIRECTORY.exists) CAPTURE_DIRECTORY.create({ intermediates: true })
  return CAPTURE_DIRECTORY
}

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
  const heard = useRef<{ transcript: string | null; uri: string | null; error: string | null }>({
    transcript: null,
    uri: null,
    error: null,
  })
  // A take is only committed once, whether recognition ended on its own or the
  // tester stopped it.
  const awaitingTake = useRef(false)

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim()
    if (transcript) heard.current.transcript = transcript
  })

  useSpeechRecognitionEvent('audioend', (event) => {
    heard.current.uri = event.uri ?? null
  })

  useSpeechRecognitionEvent('error', (event) => {
    heard.current.error = event.error ?? 'unknown'
  })

  /**
   * The take is recorded here rather than when the tester stops it. On iOS a
   * final result only arrives after recognition has stopped, and the audio path
   * arrives later still, so reading either at the moment of stopping captures
   * nothing at all.
   */
  useSpeechRecognitionEvent('end', () => {
    setListening(false)
    if (!awaitingTake.current) return
    awaitingTake.current = false

    const current = AudioRoute.getCurrentRoute()
    setRoute(current)
    setRun((existing) =>
      existing ? recordTake(existing, { ...heard.current, route: current }) : existing,
    )
  })

  const refreshRoute = useCallback(() => setRoute(AudioRoute.getCurrentRoute()), [])

  /**
   * Route changes and interruptions are recorded for the whole run, not just
   * the take in progress. Glasses that disconnect between prompts, or a call
   * that interrupts one, explain a stretch of empty takes that would otherwise
   * read as the microphone being bad.
   */
  useEffect(() => {
    const routeChanged = AudioRoute.addListener('onRouteChange', (event) => {
      setRoute(event)
      setRun((existing) =>
        existing
          ? recordEvent(existing, {
              kind: 'routeChange',
              at: new Date().toISOString(),
              reason: event.reason,
              description: describeRoute(event),
              throughGlasses: isCapturingThroughGlasses(event),
            })
          : existing,
      )
    })

    const interrupted = AudioRoute.addListener('onInterruption', (event) => {
      setRun((existing) =>
        existing
          ? recordEvent(existing, {
              kind: 'interruption',
              at: new Date().toISOString(),
              began: event.began,
            })
          : existing,
      )
    })

    return () => {
      routeChanged.remove()
      interrupted.remove()
    }
  }, [])

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

    const prompt = run ? currentPrompt(run) : null
    heard.current = { transcript: null, uri: null, error: null }
    awaitingTake.current = true
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
      recordingOptions: {
        persist: true,
        outputDirectory: captureDirectory().uri,
        // Named after the prompt so a set stays readable once the files are off
        // the device and separated from the manifest.
        outputFileName: `${run?.environment ?? 'unknown'}-${prompt?.id ?? 'unknown'}.wav`,
      },
    })

    // Reading the route after the recogniser has opened the session is the only
    // way to see which microphone it actually got.
    refreshRoute()
  }, [refreshRoute, run])

  // Stopping only asks recognition to finish. The take is committed by the
  // `end` event, once the transcript and audio path have actually arrived.
  const finishTake = useCallback(() => {
    ExpoSpeechRecognitionModule.stop()
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
