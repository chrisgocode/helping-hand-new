import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRecognition } from './recognition-run'

type Listener = (event: unknown) => void

const native = vi.hoisted(() => ({
  listeners: new Map<string, Set<Listener>>(),
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    abort: native.abort,
    addListener(eventName: string, listener: Listener) {
      const listeners = native.listeners.get(eventName) ?? new Set()
      listeners.add(listener)
      native.listeners.set(eventName, listeners)
      return { remove: () => listeners.delete(listener) }
    },
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    setAudioSessionActiveIOS: native.setActive,
    setCategoryIOS: vi.fn(),
    start: native.start,
    stop: native.stop,
  },
}))

vi.mock('../../modules/audio-route', () => ({
  default: {
    getCurrentRoute: () => ({
      inputs: [{ portName: 'Meta Glasses', portType: 'BluetoothHFP' }],
      outputs: [{ portName: 'Meta Glasses', portType: 'BluetoothHFP' }],
    }),
  },
}))

function emit(eventName: string, event: unknown = undefined) {
  for (const listener of native.listeners.get(eventName) ?? []) listener(event)
}

afterEach(() => {
  native.listeners.clear()
  native.start.mockClear()
  native.stop.mockClear()
  native.abort.mockClear()
  native.setActive.mockClear()
})

describe('runRecognition', () => {
  it('owns recognition events, recording, finishing, and cancellation', async () => {
    const run = runRecognition({
      contextualStrings: ['next'],
      recordingOptions: { persist: true, outputFileName: 'take.wav' },
    })
    await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce())

    run.finish()
    expect(native.stop).toHaveBeenCalledOnce()
    emit('result', { results: [{ transcript: ' Next ' }] })
    emit('audioend', { uri: 'file:///take.wav' })
    emit('end')

    await expect(run.result).resolves.toEqual({
      transcript: 'Next',
      uri: 'file:///take.wav',
      error: null,
    })

    const cancelled = runRecognition({ contextualStrings: [] })
    await vi.waitFor(() => expect(native.start).toHaveBeenCalledTimes(2))
    cancelled.cancel()

    await expect(cancelled.result).resolves.toMatchObject({ error: 'aborted' })
    expect(native.abort).toHaveBeenCalledOnce()
    expect(native.setActive).toHaveBeenCalledWith(false)
  })
})
