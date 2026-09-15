import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  bearer,
  createRecipient,
  enrollDevice,
  json,
  request,
  saveTaskTree,
  signInCaretaker,
  testEnv,
} from '../test/api'
import { createTestDatabase } from '../test/database'

const rootId = (suffix: string) => `00000000-0000-4000-8000-00000000000${suffix}`

describe('recipient HTTP routes', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database
  let env: ReturnType<typeof testEnv>

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
    env = testEnv(database)
  })

  afterEach(async () => miniflare.dispose())

  test('requires an authenticated caretaker', async () => {
    expect((await request(env, '/api/recipients')).status).toBe(401)
  })

  test('creates recipients that are scoped to the caretaker', async () => {
    const cookie = await signInCaretaker(env)
    const other = await signInCaretaker(env, 'other@example.com')

    const created = await createRecipient(env, cookie, 'Alex')
    expect(created).toMatchObject({
      displayName: 'Alex',
      isActive: true,
      hasActiveSession: false,
      pendingEnrollmentId: null,
    })

    const mine = await (
      await request(env, '/api/recipients', 'GET', { headers: { cookie } })
    ).json()
    const theirs = await (
      await request(env, '/api/recipients', 'GET', { headers: { cookie: other } })
    ).json()
    expect(mine).toMatchObject([{ id: created.id }])
    expect(theirs).toEqual([])

    // Another caretaker cannot see or change the recipient.
    const foreign = await json(
      env,
      `/api/recipients/${created.id}`,
      'PATCH',
      { displayName: 'Taken' },
      { cookie: other },
    )
    expect(foreign.status).toBe(404)
  })

  test('rejects a forged account kind and an empty display name', async () => {
    const cookie = await signInCaretaker(env)

    const forged = await json(
      env,
      '/api/recipients',
      'POST',
      { displayName: 'Alex', accountKind: 'caretaker' },
      { cookie },
    )
    expect(forged.status).toBe(400)

    const blank = await json(env, '/api/recipients', 'POST', { displayName: '   ' }, { cookie })
    expect(blank.status).toBe(400)
  })

  test('shares one task tree between recipients and keeps the rest private', async () => {
    const cookie = await signInCaretaker(env)
    const shared = await saveTaskTree(env, cookie, rootId('1'), 'Morning routine')
    const personal = await saveTaskTree(env, cookie, rootId('2'), 'Physiotherapy')
    await saveTaskTree(env, cookie, rootId('3'), 'Unassigned')

    const alex = await createRecipient(env, cookie, 'Alex')
    const sam = await createRecipient(env, cookie, 'Sam')

    for (const [recipientId, taskId] of [
      [alex.id, shared],
      [alex.id, personal],
      [sam.id, shared],
    ]) {
      const response = await request(env, `/api/recipients/${recipientId}/tasks/${taskId}`, 'PUT', {
        headers: { cookie },
      })
      expect(response.status).toBe(204)
    }

    // Assignment is idempotent.
    expect(
      (
        await request(env, `/api/recipients/${alex.id}/tasks/${shared}`, 'PUT', {
          headers: { cookie },
        })
      ).status,
    ).toBe(204)

    const assignments = await (
      await request(env, `/api/recipients/${alex.id}/tasks`, 'GET', { headers: { cookie } })
    ).json()
    expect(assignments).toMatchObject([{ rootTaskId: shared }, { rootTaskId: personal }])

    const alexDevice = await enrollDevice(env, cookie, alex.id)
    const samDevice = await enrollDevice(env, cookie, sam.id)

    const alexTasks = await (
      await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(alexDevice.token) })
    ).json()
    const samTasks = await (
      await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(samDevice.token) })
    ).json()

    expect((alexTasks as { id: string }[]).map(({ id }) => id).sort()).toEqual(
      [shared, personal].sort(),
    )
    expect(samTasks).toMatchObject([{ id: shared }])
    // Caretaker-only metadata never reaches a recipient.
    expect(Object.keys((samTasks as object[])[0])).toEqual([
      'id',
      'title',
      'durationSeconds',
      'children',
    ])

    const removal = await request(env, `/api/recipients/${alex.id}/tasks/${personal}`, 'DELETE', {
      headers: { cookie },
    })
    expect(removal.status).toBe(204)
    expect(
      await (
        await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(alexDevice.token) })
      ).json(),
    ).toMatchObject([{ id: shared }])
  })

  test('returns complete assigned task trees and an empty list when nothing is assigned', async () => {
    const cookie = await signInCaretaker(env)
    const root = rootId('1')
    const child = '00000000-0000-4000-8000-0000000000a1'
    await json(
      env,
      `/api/tasks/${root}`,
      'PUT',
      {
        id: root,
        title: 'Morning routine',
        durationSeconds: null,
        revision: null,
        children: [{ id: child, title: 'Brush teeth', durationSeconds: 120, children: [] }],
      },
      { cookie },
    )

    const alex = await createRecipient(env, cookie, 'Alex')
    const device = await enrollDevice(env, cookie, alex.id)
    const empty: unknown = await (
      await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(device.token) })
    ).json()
    expect(empty).toEqual([])

    await request(env, `/api/recipients/${alex.id}/tasks/${root}`, 'PUT', { headers: { cookie } })
    expect(
      await (
        await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(device.token) })
      ).json(),
    ).toMatchObject([
      {
        id: root,
        durationSeconds: 120,
        children: [{ id: child, title: 'Brush teeth', durationSeconds: 120 }],
      },
    ])

    const identity = await request(env, '/api/recipient/me', 'GET', {
      headers: bearer(device.token),
    })
    const me = (await identity.json()) as { sessionExpiresAt: string }
    expect(me).toMatchObject({ recipientId: alex.id, displayName: 'Alex' })
    // The reported expiry is the real session expiry, never "now".
    expect(Date.parse(me.sessionExpiresAt)).toBeGreaterThan(Date.now() + 60_000)
  })

  test('lets a recipient remove this device through sign-out', async () => {
    const cookie = await signInCaretaker(env)
    const alex = await createRecipient(env, cookie, 'Alex')
    const device = await enrollDevice(env, cookie, alex.id)
    const headers = bearer(device.token)

    expect((await request(env, '/api/auth/sign-out', 'POST', { headers })).status).toBe(200)
    expect((await request(env, '/api/recipient/me', 'GET', { headers })).status).toBe(401)
  })

  test('rejects assignment of a non-root task and of another caretaker task', async () => {
    const cookie = await signInCaretaker(env)
    const other = await signInCaretaker(env, 'other@example.com')
    const root = rootId('1')
    const child = '00000000-0000-4000-8000-0000000000a1'
    await json(
      env,
      `/api/tasks/${root}`,
      'PUT',
      {
        id: root,
        title: 'Morning routine',
        durationSeconds: null,
        revision: null,
        children: [{ id: child, title: 'Brush teeth', durationSeconds: 120, children: [] }],
      },
      { cookie },
    )
    const foreignRoot = await saveTaskTree(env, other, rootId('9'), 'Not yours')
    const alex = await createRecipient(env, cookie, 'Alex')

    const nonRoot = await request(env, `/api/recipients/${alex.id}/tasks/${child}`, 'PUT', {
      headers: { cookie },
    })
    expect(nonRoot.status).toBe(400)

    const foreign = await request(env, `/api/recipients/${alex.id}/tasks/${foreignRoot}`, 'PUT', {
      headers: { cookie },
    })
    expect(foreign.status).toBe(404)

    // Removing an assignment that does not exist is not an error.
    expect(
      (
        await request(env, `/api/recipients/${alex.id}/tasks/${foreignRoot}`, 'DELETE', {
          headers: { cookie },
        })
      ).status,
    ).toBe(204)
  })

  test('removes assignments when the caretaker deletes the task tree', async () => {
    const cookie = await signInCaretaker(env)
    const root = await saveTaskTree(env, cookie, rootId('1'), 'Morning routine')
    const alex = await createRecipient(env, cookie, 'Alex')
    await request(env, `/api/recipients/${alex.id}/tasks/${root}`, 'PUT', { headers: { cookie } })
    const device = await enrollDevice(env, cookie, alex.id)

    const deletion = await json(env, `/api/tasks/${root}`, 'DELETE', { revision: 0 }, { cookie })
    expect(deletion.status).toBe(204)

    const empty: unknown = await (
      await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(device.token) })
    ).json()
    expect(empty).toEqual([])
  })

  test('denies every caretaker operation to a recipient device', async () => {
    const cookie = await signInCaretaker(env)
    const alex = await createRecipient(env, cookie, 'Alex')
    const device = await enrollDevice(env, cookie, alex.id)
    const headers = bearer(device.token)

    const denied = await Promise.all([
      request(env, '/api/tasks', 'GET', { headers }),
      json(
        env,
        `/api/tasks/${rootId('1')}`,
        'PUT',
        { id: rootId('1'), title: 'Mine', durationSeconds: null, revision: null, children: [] },
        headers,
      ),
      request(env, '/api/categories', 'GET', { headers }),
      json(env, '/api/categories', 'POST', { name: 'Home' }, headers),
      request(env, '/api/recipients', 'GET', { headers }),
      json(env, '/api/recipients', 'POST', { displayName: 'Sneaky' }, headers),
      json(
        env,
        '/api/tasks/proposals/breakdown',
        'POST',
        {
          draft: {
            id: rootId('1'),
            title: 'Mine',
            durationSeconds: null,
            revision: null,
            children: [],
          },
          taskId: rootId('1'),
          detail: 3,
        },
        headers,
      ),
    ])
    expect(denied.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403, 403, 403])

    // Better Auth account mutation is not an alternate enrollment path.
    const authMutations = await Promise.all([
      json(
        env,
        '/api/auth/update-user',
        'POST',
        { name: 'Sneaky' },
        { ...headers, origin: env.TRUSTED_ORIGIN },
      ),
      json(
        env,
        '/api/auth/change-email',
        'POST',
        { newEmail: 'sneaky@example.com' },
        { ...headers, origin: env.TRUSTED_ORIGIN },
      ),
      json(
        env,
        '/api/auth/sign-up/email',
        'POST',
        { name: 'Sneaky', email: 'sneaky@example.com', password: 'test-password-123' },
        { ...headers, origin: env.TRUSTED_ORIGIN },
      ),
    ])
    expect(authMutations.map(({ status }) => status)).toEqual([403, 403, 403])

    // Reading its own session stays available.
    const session = await request(env, '/api/auth/get-session', 'GET', { headers })
    expect(session.status).toBe(200)
  })

  test('denies recipient routes to a caretaker and to an unknown token', async () => {
    const cookie = await signInCaretaker(env)
    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: { cookie } })).status,
    ).toBe(403)
    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer('not-a-token') }))
        .status,
    ).toBe(401)
  })

  test('revoking, disabling, and re-enabling control access on the next request', async () => {
    const cookie = await signInCaretaker(env)
    const root = await saveTaskTree(env, cookie, rootId('1'), 'Morning routine')
    const alex = await createRecipient(env, cookie, 'Alex')
    await request(env, `/api/recipients/${alex.id}/tasks/${root}`, 'PUT', { headers: { cookie } })
    const device = await enrollDevice(env, cookie, alex.id)
    const headers = bearer(device.token)

    expect((await request(env, '/api/recipient/tasks', 'GET', { headers })).status).toBe(200)

    const revoked = await request(env, `/api/recipients/${alex.id}/session`, 'DELETE', {
      headers: { cookie },
    })
    expect(revoked.status).toBe(204)
    expect((await request(env, '/api/recipient/tasks', 'GET', { headers })).status).toBe(401)

    // Assignments and the profile survive revocation.
    const replacement = await enrollDevice(env, cookie, alex.id)
    expect(
      await (
        await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(replacement.token) })
      ).json(),
    ).toMatchObject([{ id: root }])

    const disabled = await json(
      env,
      `/api/recipients/${alex.id}`,
      'PATCH',
      { isActive: false },
      { cookie },
    )
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({ isActive: false, hasActiveSession: false })
    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(replacement.token) }))
        .status,
    ).toBe(401)

    // Re-enabling alone does not restore the previous session.
    await json(env, `/api/recipients/${alex.id}`, 'PATCH', { isActive: true }, { cookie })
    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(replacement.token) }))
        .status,
    ).toBe(401)
  })

  test('permanently deletes a recipient without deleting their assigned task trees', async () => {
    const cookie = await signInCaretaker(env)
    const other = await signInCaretaker(env, 'other@example.com')
    const root = await saveTaskTree(env, cookie, rootId('1'), 'Morning routine')
    const alex = await createRecipient(env, cookie, 'Alex')
    await request(env, `/api/recipients/${alex.id}/tasks/${root}`, 'PUT', { headers: { cookie } })
    const device = await enrollDevice(env, cookie, alex.id)
    const recipientUser = await database
      .prepare('SELECT userId FROM recipient WHERE id = ?')
      .bind(alex.id)
      .first<{ userId: string }>()

    expect(
      (
        await request(env, `/api/recipients/${alex.id}`, 'DELETE', {
          headers: { cookie: other },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(env, `/api/recipients/${alex.id}`, 'DELETE', {
          headers: { cookie },
        })
      ).status,
    ).toBe(204)

    expect(
      await (await request(env, '/api/recipients', 'GET', { headers: { cookie } })).json(),
    ).toEqual([])
    expect(
      (await request(env, '/api/recipient/me', 'GET', { headers: bearer(device.token) })).status,
    ).toBe(401)
    expect(
      (
        await request(env, `/api/enrollments/${device.enrollmentId}`, 'GET', {
          headers: { cookie },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(env, `/api/recipients/${alex.id}/tasks`, 'GET', {
          headers: { cookie },
        })
      ).status,
    ).toBe(404)
    expect(
      await (await request(env, '/api/tasks', 'GET', { headers: { cookie } })).json(),
    ).toMatchObject([{ id: root }])
    expect(
      await database
        .prepare('SELECT id FROM "user" WHERE id = ?')
        .bind(recipientUser?.userId)
        .first(),
    ).toBeNull()
    expect(
      (
        await request(env, `/api/recipients/${alex.id}`, 'DELETE', {
          headers: { cookie },
        })
      ).status,
    ).toBe(404)
  })

  test('frees a recipient-limit slot after permanent deletion', async () => {
    const { RECIPIENT_LIMITS } = await import('@helping-hand/schemas')
    const cookie = await signInCaretaker(env)
    const recipients = []

    for (let index = 0; index < RECIPIENT_LIMITS.maxRecipientsPerCaretaker; index += 1) {
      recipients.push(await createRecipient(env, cookie, `Recipient ${index + 1}`))
    }

    const full = await json(
      env,
      '/api/recipients',
      'POST',
      { displayName: 'One too many' },
      { cookie },
    )
    expect(full.status).toBe(409)
    expect(await full.json()).toMatchObject({
      type: 'urn:helping-hand:problem:conflict',
    })

    const deleted = recipients[0]
    expect(
      (
        await request(env, `/api/recipients/${deleted.id}`, 'DELETE', {
          headers: { cookie },
        })
      ).status,
    ).toBe(204)

    const replacement = await createRecipient(env, cookie, 'Replacement')
    const listed = (await (
      await request(env, '/api/recipients', 'GET', { headers: { cookie } })
    ).json()) as { id: string }[]

    expect(listed).toHaveLength(RECIPIENT_LIMITS.maxRecipientsPerCaretaker)
    expect(listed.some(({ id }) => id === deleted.id)).toBe(false)
    expect(listed.some(({ id }) => id === replacement.id)).toBe(true)
  })

  test('keeps caretaker sign-in, tasks, categories, and guest AI behavior working', async () => {
    const cookie = await signInCaretaker(env)
    expect((await request(env, '/api/tasks', 'GET', { headers: { cookie } })).status).toBe(200)
    expect((await request(env, '/api/categories', 'GET', { headers: { cookie } })).status).toBe(200)

    // A guest still reaches the AI proposal route rather than being rejected.
    const guest = await json(env, '/api/tasks/proposals/breakdown', 'POST', {
      draft: {
        id: rootId('1'),
        title: 'Mine',
        durationSeconds: null,
        revision: null,
        children: [],
      },
      taskId: rootId('1'),
      detail: 3,
    })
    expect(guest.status).not.toBe(401)
    expect(guest.status).not.toBe(403)
  })
})
