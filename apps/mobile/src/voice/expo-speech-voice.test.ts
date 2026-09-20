import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExpoSpeechVoice } from './expo-speech-voice'

type Listener = (event: unknown) => void

const recognition = vi.hoisted(() => ({
  listeners: new Map<string, Set<Listener>>(),
  start: vi.fn(),
  abort: vi.fn(),
}))

const speech = vi.hoisted(() => ({
  getAvailableVoicesAsync: vi.fn(),
  speak: vi.fn(),
}))

vi.mock('expo-speech', () => ({
  getAvailableVoicesAsync: speech.getAvailableVoicesAsync,
  speak: speech.speak,
  stop: vi.fn(async () => {}),
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
}))

vi.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    abort: recognition.abort,
    addListener(eventName: string, listener: Listener) {
      const listeners = recognition.listeners.get(eventName) ?? new Set()
      listeners.add(listener)
      recognition.listeners.set(eventName, listeners)
      return { remove: () => listeners.delete(listener) }
    },
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    setAudioSessionActiveIOS: vi.fn(),
    setCategoryIOS: vi.fn(),
    start: recognition.start,
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
  for (const listener of recognition.listeners.get(eventName) ?? []) listener(event)
}

afterEach(() => {
  vi.useRealTimers()
  recognition.listeners.clear()
  recognition.start.mockClear()
  recognition.abort.mockClear()
  speech.getAvailableVoicesAsync.mockReset()
  speech.speak.mockReset()
})

describe('createExpoSpeechVoice', () => {
  it('uses an installed enhanced US English voice', async () => {
    vi.useFakeTimers()
    speech.getAvailableVoicesAsync.mockResolvedValue([
      { identifier: 'default', language: 'en-US', quality: 'Default' },
      { identifier: 'enhanced-gb', language: 'en-GB', quality: 'Enhanced' },
      { identifier: 'enhanced-us', language: 'en-US', quality: 'Enhanced' },
    ])
    speech.speak.mockImplementation((_text, options) => options.onDone())

    const spoken = createExpoSpeechVoice().speak('Hello')
    await vi.advanceTimersByTimeAsync(250)
    await spoken

    expect(speech.speak).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ language: 'en-US', voice: 'enhanced-us' }),
    )
  })

  it('lets the listening loop retry after a temporary native failure', async () => {
    vi.useFakeTimers()
    speech.getAvailableVoicesAsync.mockResolvedValue([])
    const voice = createExpoSpeechVoice()

    const failed = voice.listen([])
    await vi.waitFor(() => expect(recognition.start).toHaveBeenCalledTimes(1))
    emit('error', { error: 'busy' })
    emit('end')
    await vi.advanceTimersByTimeAsync(250)
    await expect(failed).resolves.toBeNull()

    const retried = voice.listen([])
    await vi.waitFor(() => expect(recognition.start).toHaveBeenCalledTimes(2))
    emit('result', { results: [{ transcript: 'Next' }] })
    emit('end')

    await expect(retried).resolves.toBe('Next')
  })
})
