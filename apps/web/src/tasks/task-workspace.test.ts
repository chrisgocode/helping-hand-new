import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import {
  deleteTaskTree,
  listTaskTrees,
  proposeTaskBreakdown,
  proposeTaskDurations,
  proposeTaskOrder,
  saveTaskTree,
  TaskWorkspaceError,
} from './task-workspace'

vi.mock('../lib/api', () => ({
  api: { DELETE: vi.fn(), GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() },
}))

const deleteTask = vi.mocked(api.DELETE)
const getTasks = vi.mocked(api.GET)
const postProposal = vi.mocked(api.POST)
const putTask = vi.mocked(api.PUT)

describe('task workspace', () => {
  beforeEach(() => {
    deleteTask.mockReset()
    getTasks.mockReset()
    postProposal.mockReset()
    putTask.mockReset()
  })

  it('returns task trees without exposing the generated client response', async () => {
    const tasks = [
      {
        id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
        title: 'Make coffee',
        durationSeconds: null,
        revision: 0,
        children: [],
      },
    ]
    getTasks.mockResolvedValueOnce({
      data: tasks,
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(listTaskTrees()).resolves.toEqual(tasks)
  })

  it.each([
    [401, 'unauthenticated', false],
    [400, 'invalid', false],
    [404, 'not_found', false],
    [409, 'conflict', false],
    [429, 'rate_limited', true],
    [503, 'unavailable', true],
    [418, 'unexpected', false],
  ] as const)('normalizes an HTTP %i response', async (status, kind, retryable) => {
    getTasks.mockResolvedValueOnce({
      error: { detail: 'Sensitive server detail' },
      response: new Response(null, { status }),
    } as never)

    const error = await listTaskTrees().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(TaskWorkspaceError)
    expect(error).toMatchObject({ kind, retryable })
    expect((error as Error).message).not.toContain('Sensitive server detail')
  })

  it('normalizes a connection failure', async () => {
    getTasks.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(listTaskTrees()).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
    })
  })

  it('saves a complete task-tree draft', async () => {
    const draft = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    }
    const saved = { ...draft, revision: 0 }
    putTask.mockResolvedValueOnce({
      data: saved,
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(saveTaskTree(draft)).resolves.toEqual(saved)
    expect(putTask).toHaveBeenCalledWith('/api/tasks/{rootId}', {
      params: { path: { rootId: draft.id } },
      body: draft,
    })
  })

  it('normalizes a save conflict without exposing server details', async () => {
    putTask.mockResolvedValueOnce({
      error: { detail: 'Sensitive conflict detail' },
      response: new Response(null, { status: 409 }),
    } as never)

    const error = await saveTaskTree({
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    }).catch((cause: unknown) => cause)

    expect(error).toMatchObject({ kind: 'conflict', retryable: false })
    expect((error as Error).message).not.toContain('Sensitive conflict detail')
  })

  it('deletes a task tree at its current revision', async () => {
    deleteTask.mockResolvedValueOnce({
      response: new Response(null, { status: 204 }),
    } as never)

    await expect(deleteTaskTree('d9cb5e16-c35e-4c60-8e28-26aa744034ee', 3)).resolves.toBeUndefined()
    expect(deleteTask).toHaveBeenCalledWith('/api/tasks/{rootId}', {
      params: { path: { rootId: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee' } },
      body: { revision: 3 },
    })
  })

  it('requests a one-level breakdown proposal for the current draft', async () => {
    const draft = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    }
    const proposal = {
      taskId: draft.id,
      children: [{ id: '66e65fa9-dac8-4800-8ce3-482dcc9c6a45', title: 'Get a mug' }],
    }
    postProposal.mockResolvedValueOnce({
      data: proposal,
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(proposeTaskBreakdown(draft, draft.id, 4)).resolves.toEqual(proposal)
    expect(postProposal).toHaveBeenCalledWith('/api/tasks/proposals/breakdown', {
      body: { draft, taskId: draft.id, detail: 4 },
    })
  })

  it('requests missing duration proposals for a selected subtree', async () => {
    const draft = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [],
    }
    const proposal = {
      taskId: draft.id,
      durations: [{ taskId: draft.id, durationSeconds: 300 }],
    }
    postProposal.mockResolvedValueOnce({
      data: proposal,
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(proposeTaskDurations(draft, draft.id)).resolves.toEqual(proposal)
    expect(postProposal).toHaveBeenCalledWith('/api/tasks/proposals/durations', {
      body: { draft, taskId: draft.id },
    })
  })

  it('requests a sibling-order proposal for the selected summary task', async () => {
    const childId = '66e65fa9-dac8-4800-8ce3-482dcc9c6a45'
    const draft = {
      id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      title: 'Make coffee',
      durationSeconds: null,
      revision: null,
      children: [{ id: childId, title: 'Get a mug', durationSeconds: null, children: [] }],
    }
    const proposal = { taskId: draft.id, orderedTaskIds: [childId] }
    postProposal.mockResolvedValueOnce({
      data: proposal,
      response: new Response(null, { status: 200 }),
    } as never)

    await expect(proposeTaskOrder(draft, draft.id)).resolves.toEqual(proposal)
    expect(postProposal).toHaveBeenCalledWith('/api/tasks/proposals/order', {
      body: { draft, taskId: draft.id },
    })
  })

  it.each([
    [500, 'ai_configuration', false],
    [502, 'ai_invalid_response', true],
    [503, 'unavailable', true],
    [504, 'ai_timeout', true],
  ] as const)('normalizes an AI HTTP %i response', async (status, kind, retryable) => {
    postProposal.mockResolvedValueOnce({
      error: { detail: 'Sensitive task and provider detail' },
      response: new Response(null, { status }),
    } as never)

    const error = await proposeTaskBreakdown(
      {
        id: 'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
        title: 'Make coffee',
        durationSeconds: null,
        revision: null,
        children: [],
      },
      'd9cb5e16-c35e-4c60-8e28-26aa744034ee',
      3,
    ).catch((cause: unknown) => cause)

    expect(error).toMatchObject({ kind, retryable })
    expect((error as Error).message).not.toContain('Sensitive task and provider detail')
  })
})
