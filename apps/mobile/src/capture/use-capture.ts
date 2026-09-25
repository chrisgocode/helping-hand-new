import { Directory, Paths } from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import AudioRoute, { type AudioRouteDescription } from '../../modules/audio-route'
import { COMMAND_PHRASES } from '../session/session-intent'
import { describeRoute, isCapturingThroughBluetoothMic } from '../voice/audio-route'
import { type RecognitionRun, runRecognition } from '../voice/recognition-run'
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
  /** Whether a take is being set up: permission, route, and recogniser start. */
  readonly starting: boolean
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
  const [starting, setStarting] = useState(false)
  const [listening, setListening] = useState(false)
  const [route, setRoute] = useState<AudioRouteDescription | null>(null)
  const activeRecognition = useRef<RecognitionRun | null>(null)
  // The last completed run still owns the active audio session until this
  // screen leaves, even though it no longer blocks the next take.
  const sessionRecognition = useRef<RecognitionRun | null>(null)
  // Recognition and the audio session both outlive a render. Leaving the screen
  // mid-take has to tear down each of them, and the setup is asynchronous, so
  // the continuation also has to notice it is no longer wanted.
  const mounted = useRef(true)

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
              throughBluetoothMic: isCapturingThroughBluetoothMic(event),
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

  /**
   * Cancels anything this hook started when it goes away.
   *
   * Without this, unmounting during setup still lets the continuation call
   * `start`, and unmounting after it leaves recognition running against an
   * audio session nothing will deactivate — so the phone keeps recording once
   * the tester has left the screen. `AudioRoute` exposes no teardown of its
   * own, so the session is deactivated through the recogniser that opened it.
   */
  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      sessionRecognition.current?.cancel()
      activeRecognition.current = null
      sessionRecognition.current = null
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
    if (activeRecognition.current) return
    setStarting(true)

    const prompt = run ? currentPrompt(run) : null
    const recognition = runRecognition({
      contextualStrings: CONTEXTUAL_STRINGS,
      recordingOptions: {
        persist: true,
        outputDirectory: captureDirectory().uri,
        // Named after the prompt so a set stays readable once the files are off
        // the device and separated from the manifest.
        outputFileName: `${run?.environment ?? 'unknown'}-${prompt?.id ?? 'unknown'}.wav`,
      },
      onStart: () => {
        if (!mounted.current) return
        setStarting(false)
        setListening(true)
        refreshRoute()
      },
    })
    activeRecognition.current = recognition
    sessionRecognition.current = recognition

    try {
      const heard = await recognition.result
      if (!mounted.current || activeRecognition.current !== recognition) return

      const current = AudioRoute.getCurrentRoute()
      setRoute(current)
      setRun((existing) =>
        existing
          ? recordTake(existing, {
              transcript: heard.transcript,
              uri: heard.uri,
              error: heard.error,
              route: current,
            })
          : existing,
      )
    } catch {
      // Permission denial and startup failures leave the take available to retry.
    } finally {
      if (activeRecognition.current === recognition) {
        activeRecognition.current = null
        if (mounted.current) {
          setStarting(false)
          setListening(false)
        }
      }
    }
  }, [refreshRoute, run])

  // Stopping only asks recognition to finish. The take is committed by the
  // `end` event, once the transcript and audio path have actually arrived.
  const finishTake = useCallback(() => {
    activeRecognition.current?.finish()
  }, [])

  const redo = useCallback(
    () => setRun((existing) => (existing ? redoLast(existing) : existing)),
    [],
  )

  return {
    run,
    starting,
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
