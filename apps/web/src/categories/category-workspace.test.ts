import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { WorkspaceError } from '../lib/workspace-error'
import {
  assignTaskCategory,
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from './category-workspace'

vi.mock('../lib/api', () => ({
  api: { DELETE: vi.fn(), GET: vi.fn(), PATCH: vi.fn(), POST: vi.fn(), PUT: vi.fn() },
}))

const deleteCategoryRequest = vi.mocked(api.DELETE)
const getCategories = vi.mocked(api.GET)
const patchTask = vi.mocked(api.PATCH)
const postCategory = vi.mocked(api.POST)
const putCategories = vi.mocked(api.PUT)

describe('category workspace', () => {
  beforeEach(() => {
    deleteCategoryRequest.mockReset()
    getCategories.mockReset()
    patchTask.mockReset()
    postCategory.mockReset()
    putCategories.mockReset()
  })

  it('creates, renames, reorders, and deletes categories through typed routes', async () => {
    const category = {
      id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45',
      name: 'Home',
      position: 0,
      createdAt: '2026-09-02T12:00:00.000Z',
      updatedAt: '2026-09-02T12:00:00.000Z',
    }
    const renamed = { ...category, name: 'Household' }
    postCategory.mockResolvedValueOnce({
      data: category,
      response: new Response(null, { status: 201 }),
    } as never)
    patchTask.mockResolvedValueOnce({
      data: renamed,
      response: new Response(null, { status: 200 }),
    } as never)
    putCategories.mockResolvedValueOnce({
      data: [renamed],
      response: new Response(null, { status: 200 }),
    } as never)
    deleteCategoryRequest.mockResolvedValueOnce({
      response: new Response(null, { status: 204 }),
    } as never)

    await expect(createCategory('Home')).resolves.toEqual(category)
    await expect(renameCategory(category.id, 'Household')).resolves.toEqual(renamed)
    await expect(reorderCategories([category.id])).resolves.toEqual([renamed])
    await expect(deleteCategory(category.id)).resolves.toBeUndefined()

    expect(postCategory).toHaveBeenCalledWith('/api/categories', { body: { name: 'Home' } })
    expect(patchTask).toHaveBeenCalledWith('/api/categories/{categoryId}', {
      params: { path: { categoryId: category.id } },
      body: { name: 'Household' },
    })
    expect(putCategories).toHaveBeenCalledWith('/api/categories/order', {
      body: { categoryIds: [category.id] },
    })
    expect(deleteCategoryRequest).toHaveBeenCalledWith('/api/categories/{categoryId}', {
      params: { path: { categoryId: category.id } },
    })
  })

  it.each([
    ['create', 409, 'A category with this name already exists.'],
    ['rename', 400, 'Enter a category name between 1 and 100 characters.'],
    ['reorder', 409, 'Categories changed elsewhere. Reload and try again.'],
  ] as const)('returns a readable %s failure', async (operation, status, message) => {
    const response = {
      error: { detail: 'Internal category detail' },
      response: new Response(null, { status }),
    } as never

    let request: Promise<unknown>
    if (operation === 'create') {
      postCategory.mockResolvedValueOnce(response)
      request = createCategory('Home')
    } else if (operation === 'rename') {
      patchTask.mockResolvedValueOnce(response)
      request = renameCategory(crypto.randomUUID(), 'Home')
    } else {
      putCategories.mockResolvedValueOnce(response)
      request = reorderCategories([])
    }

    await expect(request).rejects.toMatchObject({ message })
  })

  it('loads categories and assigns one to a root task', async () => {
    const rootId = 'd9cb5e16-c35e-4c60-8e28-26aa744034ee'
    const category = {
      id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45',
      name: 'Kitchen',
      position: 0,
      createdAt: '2026-09-02T12:00:00.000Z',
      updatedAt: '2026-09-02T12:00:00.000Z',
    }
    getCategories.mockResolvedValueOnce({
      data: [category],
      response: new Response(null, { status: 200 }),
    } as never)
    patchTask.mockResolvedValueOnce({
      data: { rootId, categoryId: category.id },
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(listCategories()).resolves.toEqual([category])
    await expect(assignTaskCategory(rootId, category.id)).resolves.toEqual({
      rootId,
      categoryId: category.id,
    })
    expect(patchTask).toHaveBeenCalledWith('/api/tasks/{rootId}/category', {
      params: { path: { rootId } },
      body: { categoryId: category.id },
    })
  })

  it('normalizes failures without exposing response details', async () => {
    getCategories.mockResolvedValueOnce({
      error: { detail: 'Sensitive database detail' },
      response: new Response(null, { status: 503 }),
    } as never)

    const error = await listCategories().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkspaceError)
    expect(error).toMatchObject({ kind: 'unavailable', retryable: true })
    expect((error as Error).message).not.toContain('Sensitive database detail')
  })
})
