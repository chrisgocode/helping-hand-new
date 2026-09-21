import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecognitionResult, RecognitionRun } from '../voice/recognition-run'
import { useCapture } from './use-capture'

const recognition = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../voice/recognition-run', () => ({ runRecognition: recognition.run }))

vi.mock('expo-file-system', () => ({
  Directory: class {
    exists = true
    uri = 'file:///documents/captures'
    create() {}
  },
  Paths: { document: 'file:///documents' },
}))

vi.mock('../../modules/audio-route', () => ({
  default: {
    addListener: () => ({ remove() {} }),
    getCurrentRoute: () => ({
      inputs: [{ portName: 'Meta Glasses', portType: 'BluetoothHFP' }],
      outputs: [{ portName: 'Meta Glasses', portType: 'BluetoothHFP' }],
    }),
  },
}))

afterEach(() => recognition.run.mockReset())

describe('useCapture', () => {
  it('records and cancels a take through the shared recognition run', async () => {
    let resolve = (_result: RecognitionResult) => {}
    const finish = vi.fn()
    const cancel = vi.fn()
    recognition.run.mockImplementation(({ onStart }) => {
      const result = new Promise<RecognitionResult>((done) => {
        resolve = done
      })
      queueMicrotask(() => onStart?.())
      return { result, finish, cancel } satisfies RecognitionRun
    })

    const hook = renderHook(() => useCapture())
    act(() => hook.result.current.begin('quiet'))

    let listening = Promise.resolve()
    act(() => {
      listening = hook.result.current.listen()
    })
    await waitFor(() => expect(hook.result.current.listening).toBe(true))

    act(() => hook.result.current.finishTake())
    expect(finish).toHaveBeenCalledOnce()

    await act(async () => {
      resolve({ transcript: 'Done', uri: 'file:///take.wav', error: null })
      await listening
    })

    expect(hook.result.current.run?.takes[0]).toMatchObject({
      transcript: 'Done',
      uri: 'file:///take.wav',
      throughBluetoothMic: true,
    })

    hook.unmount()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
