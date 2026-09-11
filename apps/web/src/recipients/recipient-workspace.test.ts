import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { WorkspaceError } from '../lib/workspace-error'
import {
  assignRecipientTask,
  createRecipient,
  deleteRecipient,
  listRecipientAssignments,
  listRecipients,
  revokeRecipientAccess,
  unassignRecipientTask,
  updateRecipient,
} from './recipient-workspace'

vi.mock('../lib/api', () => ({
  api: { DELETE: vi.fn(), GET: vi.fn(), PATCH: vi.fn(), POST: vi.fn(), PUT: vi.fn() },
}))

const deleteRequest = vi.mocked(api.DELETE)
const getRequest = vi.mocked(api.GET)
const patchRequest = vi.mocked(api.PATCH)
const postRequest = vi.mocked(api.POST)
const putRequest = vi.mocked(api.PUT)

const recipientId = 'd7cb98a2-1f0d-4d55-8f0f-0d6f2e3a55f1'
const taskId = 'd9cb5e16-c35e-4c60-8e28-26aa744034ee'

const recipient = {
  id: recipientId,
  displayName: 'Alex',
  isActive: true,
  hasActiveSession: false,
  pendingEnrollmentId: null,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
}

const ok = (status = 200) => new Response(null, { status })
const problem = (status: number, type: string) =>
  ({ error: { type, title: 'Problem', status }, response: new Response(null, { status }) }) as never

describe('recipient workspace', () => {
  beforeEach(() => {
    deleteRequest.mockReset()
    getRequest.mockReset()
    patchRequest.mockReset()
    postRequest.mockReset()
    putRequest.mockReset()
  })

  it('lists, creates, and updates recipients through typed routes', async () => {
    getRequest.mockResolvedValue({ data: [recipient], response: ok() } as never)
    postRequest.mockResolvedValue({ data: recipient, response: ok(201) } as never)
    patchRequest.mockResolvedValue({
      data: { ...recipient, isActive: false },
      response: ok(),
    } as never)

    expect(await listRecipients()).toEqual([recipient])
    expect(await createRecipient('Alex')).toEqual(recipient)
    expect((await updateRecipient(recipientId, { isActive: false })).isActive).toBe(false)

    expect(getRequest).toHaveBeenCalledWith('/api/recipients')
    expect(postRequest).toHaveBeenCalledWith('/api/recipients', { body: { displayName: 'Alex' } })
    expect(patchRequest).toHaveBeenCalledWith('/api/recipients/{recipientId}', {
      params: { path: { recipientId } },
      body: { isActive: false },
    })
  })

  it('reads assignments and assigns and unassigns task trees', async () => {
    const assignment = { rootTaskId: taskId, createdAt: '2026-09-02T12:00:00.000Z' }
    getRequest.mockResolvedValue({ data: [assignment], response: ok() } as never)
    putRequest.mockResolvedValue({ data: undefined, response: ok(204) } as never)
    deleteRequest.mockResolvedValue({ data: undefined, response: ok(204) } as never)

    expect(await listRecipientAssignments(recipientId)).toEqual([assignment])
    await assignRecipientTask(recipientId, taskId)
    await unassignRecipientTask(recipientId, taskId)

    expect(putRequest).toHaveBeenCalledWith('/api/recipients/{recipientId}/tasks/{taskId}', {
      params: { path: { recipientId, taskId } },
    })
    expect(deleteRequest).toHaveBeenCalledWith('/api/recipients/{recipientId}/tasks/{taskId}', {
      params: { path: { recipientId, taskId } },
    })
  })

  it('deletes a recipient through the typed route', async () => {
    deleteRequest.mockResolvedValue({ data: undefined, response: ok(204) } as never)

    await deleteRecipient(recipientId)

    expect(deleteRequest).toHaveBeenCalledWith('/api/recipients/{recipientId}', {
      params: { path: { recipientId } },
    })
  })

  it('fails a 204 route by status, because an empty body carries no error', async () => {
    // openapi-fetch returns `{ error: undefined }` for an empty body even when
    // the response failed, so the seam has to read `response.ok` instead.
    deleteRequest.mockResolvedValue({ error: undefined, response: ok(404) } as never)

    await expect(revokeRecipientAccess(recipientId)).rejects.toMatchObject({
      kind: 'not_found',
      message: 'This recipient could not be found.',
    })
  })

  it('separates the recipient limit from the assignment limit', async () => {
    postRequest.mockResolvedValue(problem(409, 'urn:helping-hand:problem:conflict'))
    putRequest.mockResolvedValue({ error: undefined, response: ok(409) } as never)

    await expect(createRecipient('Alex')).rejects.toMatchObject({
      message: 'You can support up to 25 recipients. Delete one before adding another.',
    })
    await expect(assignRecipientTask(recipientId, taskId)).rejects.toMatchObject({
      message: 'This recipient already has 50 assigned tasks. Remove one before assigning another.',
    })
  })

  it('explains an invalid name and an invalid assignment differently', async () => {
    postRequest.mockResolvedValue(problem(400, 'urn:helping-hand:problem:validation'))
    putRequest.mockResolvedValue({ error: undefined, response: ok(400) } as never)

    await expect(createRecipient(' ')).rejects.toMatchObject({
      message: 'Enter a name between 1 and 100 characters.',
    })
    await expect(assignRecipientTask(recipientId, taskId)).rejects.toMatchObject({
      message: 'Only a whole task can be assigned. Choose a task from your library.',
    })
  })

  it('reports a transport failure as retryable', async () => {
    getRequest.mockRejectedValue(new TypeError('Failed to fetch'))

    const failure = await listRecipients().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkspaceError)
    expect(failure).toMatchObject({ kind: 'unavailable', retryable: true })
  })
})
