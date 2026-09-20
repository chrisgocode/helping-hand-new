import type { TaskNode } from '@helping-hand/schemas'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { VoiceInterface } from '../voice/voice-interface'
import { useGuidedSession } from './use-guided-session'

const tree: TaskNode = {
  id: 'root',
  title: 'Morning routine',
  durationSeconds: null,
  children: [
    { id: 'teeth', title: 'Brush teeth', durationSeconds: 120, children: [] },
    { id: 'face', title: 'Wash face', durationSeconds: 30, children: [] },
  ],
}

/** A voice that records what it was asked to say, standing in for any output. */
function createRecordingVoice() {
  const spoken: string[] = []
  let stopped = 0

  const voice: VoiceInterface = {
    async speak(text) {
      spoken.push(text)
    },
    async stop() {
      stopped += 1
    },
  }

  return { voice, spoken, stopCount: () => stopped }
}

describe('useGuidedSession', () => {
  it('speaks the opening line on start', async () => {
    const { voice, spoken } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))

    expect(spoken).toEqual(['Let us start Morning routine. First, Brush teeth.'])
    expect(result.current.task?.title).toBe('Brush teeth')
  })

  it('advances on a recognised transcript', async () => {
    const { voice, spoken } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))
    await act(async () => {
      expect(await result.current.hear('done')).toBe(true)
    })

    expect(result.current.task?.title).toBe('Wash face')
    expect(spoken.at(-1)).toBe('Next, Wash face.')
  })

  it('reports an unrecognised transcript instead of guessing', async () => {
    const { voice, spoken } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))
    const before = spoken.length

    await act(async () => {
      expect(await result.current.hear('I do not understand this one')).toBe(false)
    })

    expect(result.current.task?.title).toBe('Brush teeth')
    expect(spoken).toHaveLength(before)
  })

  it('applies consecutive commands against the newest session', async () => {
    const { voice, spoken } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))
    await act(() => result.current.submit('next'))
    await act(() => result.current.submit('back'))

    expect(result.current.task?.title).toBe('Brush teeth')
    expect(spoken.at(-1)).toBe('Going back. Brush teeth.')
  })

  it('answers duration without moving', async () => {
    const { voice, spoken } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))
    await act(() => result.current.submit('duration'))

    expect(result.current.task?.title).toBe('Brush teeth')
    expect(spoken.at(-1)).toBe('About 2 minutes.')
  })

  it('stops the voice when the session ends', async () => {
    const { voice, spoken, stopCount } = createRecordingVoice()
    const { result } = renderHook(() => useGuidedSession(voice))

    await act(() => result.current.start(tree))
    await act(() => result.current.end())

    expect(spoken.at(-1)).toBe('Stopping here.')
    expect(stopCount()).toBe(1)
    expect(result.current.task).toBeNull()
  })

  it('reports while a line is being spoken', async () => {
    let release = () => {}
    const voice: VoiceInterface = {
      speak: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
      stop: async () => {},
    }

    const { result } = renderHook(() => useGuidedSession(voice))

    act(() => {
      void result.current.start(tree)
    })
    await waitFor(() => expect(result.current.isSpeaking).toBe(true))

    await act(async () => {
      release()
    })
    expect(result.current.isSpeaking).toBe(false)
  })
})
