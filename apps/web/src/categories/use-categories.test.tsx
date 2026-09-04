import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCategory, listCategories } from './category-workspace'
import { useCategories } from './use-categories'

vi.mock('./category-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./category-workspace')>()),
  createCategory: vi.fn(),
  listCategories: vi.fn(),
}))

const create = vi.mocked(createCategory)
const list = vi.mocked(listCategories)

describe('useCategories', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    list.mockResolvedValue([])
    create.mockResolvedValue({
      id: '56c4ec32-4018-455b-b29c-3b8c251fc929',
      name: 'Home',
      position: 0,
      createdAt: '2026-09-04T12:00:00.000Z',
      updatedAt: '2026-09-04T12:00:00.000Z',
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('clears a successful category announcement after four seconds', async () => {
    const { result } = renderHook(useCategories)
    await act(async () => {})

    await act(() => result.current.create('Home'))
    expect(result.current.announcement).toBe('Home added.')

    act(() => vi.advanceTimersByTime(4000))
    expect(result.current.announcement).toBe('')
  })
})
