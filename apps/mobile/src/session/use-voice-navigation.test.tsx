import type { RecipientTaskTree } from '@helping-hand/schemas'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { VoiceInterface } from '../voice/voice-interface'
import { useVoiceNavigation } from './use-voice-navigation'

const kitchen = { id: '11111111-1111-4111-8111-111111111111', name: 'Kitchen' }

const trees: RecipientTaskTree[] = [
  {
    id: 'coffee',
    title: 'Make coffee',
    durationSeconds: null,
    category: kitchen,
    children: [
      { id: 'kettle', title: 'Fill the kettle', durationSeconds: 60, children: [] },
      { id: 'pour', title: 'Pour the water', durationSeconds: 30, children: [] },
    ],
  },
  { id: 'meds', title: 'Take medication', durationSeconds: null, children: [], category: null },
]

function setup() {
  const spoken: string[] = []
  const voice: VoiceInterface = {
    async speak(text) {
      spoken.push(text)
    },
    async listen() {
      return null
    },
    async stop() {},
  }

  return { spoken, ...renderHook(() => useVoiceNavigation(voice, trees)) }
}

describe('useVoiceNavigation', () => {
  it('reads the categories back', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('list my categories'))

    expect(spoken.at(-1)).toContain('Kitchen')
    expect(result.current.position).toEqual({ kind: 'catalog' })
  })

  it('opens a category by its name after listing categories', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('list my categories'))
    await act(async () => {
      expect(await result.current.hear('kitchen')).toBe('browsed')
    })

    expect(result.current.position).toMatchObject({ kind: 'category' })
    expect(spoken.at(-1)).toContain('Make coffee')
  })

  it('narrows into a category and reads its routines', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('list tasks from kitchen'))

    expect(result.current.position).toMatchObject({ kind: 'category' })
    expect(spoken.at(-1)).toContain('Make coffee')
  })

  it('starts a routine by name and announces its first task', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('start make coffee'))

    expect(result.current.isRunning).toBe(true)
    expect(result.current.session.task?.title).toBe('Fill the kettle')
    expect(spoken).toContain('Starting Make coffee.')
    expect(spoken.at(-1)).toContain('Fill the kettle')
  })

  it('keeps listening through a complete routine', async () => {
    const spoken: string[] = []
    const transcripts = ['start make coffee', 'done', 'done']
    let finishListening = (_transcript: string | null) => {}
    const voice: VoiceInterface = {
      async speak(text) {
        spoken.push(text)
      },
      async listen() {
        return (
          transcripts.shift() ??
          new Promise<string | null>((resolve) => {
            finishListening = resolve
          })
        )
      },
      async stop() {
        finishListening(null)
      },
    }
    const { result } = renderHook(() => useVoiceNavigation(voice, trees))

    act(() => result.current.startListening())

    await waitFor(() => expect(spoken.at(-1)).toBe('That is everything. Nice work.'))
    expect(result.current.session.task).toBeNull()
    expect(result.current.voiceEnabled).toBe(true)

    await act(() => result.current.stopListening())
  })

  it('keeps listening after an unrecognised utterance', async () => {
    const spoken: string[] = []
    const transcripts = ['start make coffee', 'something else', 'next']
    let finishListening = (_transcript: string | null) => {}
    const voice: VoiceInterface = {
      async speak(text) {
        spoken.push(text)
      },
      async listen() {
        return (
          transcripts.shift() ??
          new Promise<string | null>((resolve) => {
            finishListening = resolve
          })
        )
      },
      async stop() {
        finishListening(null)
      },
    }
    const { result } = renderHook(() => useVoiceNavigation(voice, trees))

    act(() => result.current.startListening())

    await waitFor(() => expect(spoken.at(-1)).toBe('Next, Pour the water.'))
    expect(result.current.voiceEnabled).toBe(true)

    await act(() => result.current.stopListening())
  })

  it('turns voice controls off when the recipient says stop helping hand', async () => {
    const spoken: string[] = []
    let listenCount = 0
    const voice: VoiceInterface = {
      async speak(text) {
        spoken.push(text)
      },
      async listen() {
        listenCount += 1
        return 'stop helping hand'
      },
      async stop() {},
    }
    const { result } = renderHook(() => useVoiceNavigation(voice, trees))

    act(() => result.current.startListening())

    await waitFor(() => expect(result.current.voiceEnabled).toBe(false))
    expect(spoken.at(-1)).toBe('Voice controls are off.')
    expect(listenCount).toBe(1)
  })

  it('treats traversal commands as traversal once a routine is running', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('start make coffee'))
    await act(async () => {
      expect(await result.current.hear('done')).toBe('traversed')
    })

    expect(result.current.session.task?.title).toBe('Pour the water')
    expect(spoken.at(-1)).toBe('Next, Pour the water.')
  })

  it('still browses mid-routine when the words are not traversal', async () => {
    const { result } = setup()

    await act(() => result.current.hear('start make coffee'))
    await act(async () => {
      expect(await result.current.hear('start take medication')).toBe('browsed')
    })

    expect(result.current.session.task?.title).toBe('Take medication')
  })

  it('asks the recipient to retry anything it cannot answer', async () => {
    const { result, spoken } = setup()

    await act(async () => {
      expect(await result.current.hear('why do I have to do this')).toBe('unrecognised')
    })

    expect(spoken.at(-1)).toBe('I did not understand. Please try again.')
  })

  it('explains an unknown name rather than guessing', async () => {
    const { result, spoken } = setup()

    await act(() => result.current.hear('start gardening'))

    expect(result.current.isRunning).toBe(false)
    expect(spoken.at(-1)).toContain('gardening')
  })
})
