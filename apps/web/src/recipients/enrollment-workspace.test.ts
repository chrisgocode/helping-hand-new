import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { PROBLEM } from '../lib/problem'
import {
  approveEnrollment,
  cancelEnrollment,
  encodeEnrollmentPayload,
  getEnrollment,
  issueEnrollment,
} from './enrollment-workspace'

vi.mock('../lib/api', () => ({
  api: { DELETE: vi.fn(), GET: vi.fn(), PATCH: vi.fn(), POST: vi.fn(), PUT: vi.fn() },
}))

const deleteRequest = vi.mocked(api.DELETE)
const getRequest = vi.mocked(api.GET)
const postRequest = vi.mocked(api.POST)

const recipientId = 'd7cb98a2-1f0d-4d55-8f0f-0d6f2e3a55f1'
const enrollmentId = '44444444-4444-4444-8444-444444444444'
const secret = 'SGVsbG8tdGhpcy1pcy1hLTQzLWNoYXJhY3Rlci1zZWNyZXQ'
const payload = { version: 1 as const, enrollmentId, secret }

const ok = (status = 200) => new Response(null, { status })
const problem = (status: number, type: string, headers?: Record<string, string>) =>
  ({
    error: { type, title: 'Problem', status },
    response: new Response(null, { status, headers }),
  }) as never

describe('enrollment payload encoding', () => {
  it('encodes the stable payload the device has to read', () => {
    expect(encodeEnrollmentPayload(payload)).toBe(
      `{"version":1,"enrollmentId":"${enrollmentId}","secret":"${secret}"}`,
    )
  })
})

describe('enrollment workspace', () => {
  beforeEach(() => {
    deleteRequest.mockReset()
    getRequest.mockReset()
    postRequest.mockReset()
  })

  it('issues an enrollment and hands the payload back untouched', async () => {
    const issued = {
      id: enrollmentId,
      state: 'issued',
      payload,
      expiresAt: '2026-09-09T12:10:00.000Z',
    }
    postRequest.mockResolvedValue({ data: issued, response: ok(201) } as never)

    expect(await issueEnrollment(recipientId)).toEqual(issued)
    expect(postRequest).toHaveBeenCalledWith('/api/recipients/{recipientId}/enrollments', {
      params: { path: { recipientId } },
    })
  })

  it('explains that a disabled recipient cannot be enrolled', async () => {
    postRequest.mockResolvedValue(problem(409, PROBLEM.conflict))

    await expect(issueEnrollment(recipientId)).rejects.toMatchObject({
      message: 'This recipient is disabled. Turn their access back on before enrolling a device.',
    })
  })

  it('reads an enrollment state', async () => {
    const status = {
      id: enrollmentId,
      recipientId,
      state: 'claimed',
      matchingCode: 'AB3D9K',
      expiresAt: '2026-09-09T12:10:00.000Z',
    }
    getRequest.mockResolvedValue({ data: status, response: ok() } as never)

    expect(await getEnrollment(enrollmentId)).toEqual(status)
  })

  it('tells a stale matching code apart from a wrong enrollment state', async () => {
    postRequest.mockResolvedValueOnce(problem(409, PROBLEM.enrollmentConflict))
    await expect(approveEnrollment(enrollmentId, 'AB3D9K')).rejects.toMatchObject({
      problemType: PROBLEM.enrollmentConflict,
      message:
        'The device is not showing this code any more. Compare the codes again before approving.',
    })

    postRequest.mockResolvedValueOnce(problem(409, PROBLEM.conflict))
    await expect(approveEnrollment(enrollmentId, 'AB3D9K')).rejects.toMatchObject({
      message: 'This enrollment is not waiting for approval. Show a new code.',
    })
  })

  it('falls back to the status when the problem type is missing', async () => {
    postRequest.mockResolvedValue({
      error: 'Conflict',
      response: new Response(null, { status: 409 }),
    } as never)

    await expect(approveEnrollment(enrollmentId, 'AB3D9K')).rejects.toMatchObject({
      kind: 'conflict',
      message: 'This enrollment is not waiting for approval. Show a new code.',
    })
  })

  it('reports a closed delivery window as gone', async () => {
    postRequest.mockResolvedValue(problem(410, PROBLEM.enrollmentExpired))

    await expect(approveEnrollment(enrollmentId, 'AB3D9K')).rejects.toMatchObject({
      kind: 'gone',
      message: 'This enrollment expired. Show a new code to continue.',
    })
  })

  it('carries Retry-After through a rate-limited poll', async () => {
    getRequest.mockResolvedValue(problem(429, PROBLEM.rateLimited, { 'Retry-After': '60' }))

    await expect(getEnrollment(enrollmentId)).rejects.toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 60,
    })
  })

  it('treats cancelling an enrollment that is already gone as success', async () => {
    deleteRequest.mockResolvedValue({ error: undefined, response: ok(404) } as never)

    await expect(cancelEnrollment(enrollmentId)).resolves.toBeUndefined()
  })
})
