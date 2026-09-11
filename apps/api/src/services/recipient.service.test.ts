import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RECIPIENT_LIMITS } from '@helping-hand/schemas'
import { createTestDatabase, createTestUser } from '../test/database'
import { EnrollmentService } from './enrollment.service'
import { RecipientService } from './recipient.service'
import type { RecipientAuth } from './recipient-auth'
import { createRecipientAuth } from './recipient-auth'

const authOptions = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  BETTER_AUTH_URL: 'http://localhost:8787',
  TRUSTED_ORIGIN: 'http://localhost:5173',
}

describe('RecipientService', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database
  let recipientAuth: RecipientAuth
  let recipients: RecipientService

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
    await createTestUser(database, 'caretaker-1')
    await createTestUser(database, 'caretaker-2')
    recipientAuth = createRecipientAuth({ database, ...authOptions })
    recipients = new RecipientService({ database, recipientAuth })
  })

  afterEach(async () => miniflare.dispose())

  /** Arranges a saved task tree owned by a caretaker. */
  async function saveTree(caretakerId: string, id: string, childId?: string) {
    await database
      .prepare('INSERT INTO task (id, userId, parentId, title, position) VALUES (?, ?, NULL, ?, 0)')
      .bind(id, caretakerId, `Tree ${id}`)
      .run()
    if (childId) {
      await database
        .prepare(
          'INSERT INTO task (id, userId, parentId, title, position, durationSeconds) VALUES (?, ?, ?, ?, 0, 120)',
        )
        .bind(childId, caretakerId, id, `Child ${childId}`)
        .run()
    }
    return id
  }

  test('creates a recipient scoped to its caretaker and trims the display name', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: '  Alex  ' })

    expect(alex.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(alex).toMatchObject({
      displayName: 'Alex',
      isActive: true,
      hasActiveSession: false,
      pendingEnrollmentId: null,
    })
    expect(alex.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await recipients.listRecipients('caretaker-1')).toEqual([alex])
    expect(await recipients.listRecipients('caretaker-2')).toEqual([])
  })

  test('rejects an empty display name and more recipients than the limit', async () => {
    expect(recipients.createRecipient('caretaker-1', { displayName: '   ' })).rejects.toMatchObject(
      {
        code: 'invalid',
      },
    )

    for (let index = 0; index < RECIPIENT_LIMITS.maxRecipientsPerCaretaker; index += 1) {
      await recipients.createRecipient('caretaker-1', { displayName: `Recipient ${index}` })
    }
    expect(
      recipients.createRecipient('caretaker-1', { displayName: 'One too many' }),
    ).rejects.toMatchObject({ code: 'conflict' })

    const [first] = await recipients.listRecipients('caretaker-1')
    await recipients.deleteRecipient('caretaker-1', first.id)
    expect(
      await recipients.createRecipient('caretaker-1', { displayName: 'Replacement' }),
    ).toMatchObject({ displayName: 'Replacement' })
  })

  test('leaves no identity behind when the recipient profile cannot be stored', async () => {
    const existing = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    const takenUserId = (
      await database
        .prepare('SELECT userId FROM recipient WHERE id = ?')
        .bind(existing.id)
        .first<{ userId: string }>()
    )?.userId as string

    const deleted: string[] = []
    const reusingAuth: RecipientAuth = {
      createRecipientUser: async () => takenUserId,
      deleteUser: async (userId) => {
        deleted.push(userId)
      },
      createSession: recipientAuth.createSession,
    }
    const failing = new RecipientService({ database, recipientAuth: reusingAuth })

    await expect(failing.createRecipient('caretaker-1', { displayName: 'Sam' })).rejects.toThrow()

    expect(deleted).toEqual([takenUserId])
    expect(await recipients.listRecipients('caretaker-1')).toEqual([existing])
  })

  test('updates a display name and refuses another caretakers recipient', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })

    const renamed = await recipients.updateRecipient('caretaker-1', alex.id, {
      displayName: 'Alexandra',
    })

    expect(renamed).toMatchObject({ id: alex.id, displayName: 'Alexandra', isActive: true })
    expect(
      recipients.updateRecipient('caretaker-2', alex.id, { displayName: 'Taken' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(recipients.listAssignments('caretaker-2', alex.id)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(recipients.revokeRecipientAccess('caretaker-2', alex.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  test('assigns only a root task the caretaker owns', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    const root = await saveTree('caretaker-1', 'root-1', 'child-1')
    const foreign = await saveTree('caretaker-2', 'root-2')

    await recipients.assignTaskTree('caretaker-1', alex.id, root)
    // Assignment is idempotent.
    await recipients.assignTaskTree('caretaker-1', alex.id, root)
    expect(await recipients.listAssignments('caretaker-1', alex.id)).toMatchObject([
      { rootTaskId: root },
    ])

    expect(recipients.assignTaskTree('caretaker-1', alex.id, 'child-1')).rejects.toMatchObject({
      code: 'invalid',
    })
    expect(recipients.assignTaskTree('caretaker-1', alex.id, foreign)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(recipients.assignTaskTree('caretaker-1', 'missing', root)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  test('rejects a non-root assignment in the database, not only in the service', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    await saveTree('caretaker-1', 'root-1', 'child-1')

    expect(
      database
        .prepare(
          'INSERT INTO task_assignment (recipientId, rootTaskId, caretakerId) VALUES (?, ?, ?)',
        )
        .bind(alex.id, 'child-1', 'caretaker-1')
        .run(),
    ).rejects.toThrow(/Only a root task can be assigned/)
  })

  test('rejects more assignments than the limit and removes one idempotently', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    for (let index = 0; index < RECIPIENT_LIMITS.maxAssignmentsPerRecipient; index += 1) {
      await recipients.assignTaskTree(
        'caretaker-1',
        alex.id,
        await saveTree('caretaker-1', `root-${index}`),
      )
    }

    expect(
      recipients.assignTaskTree('caretaker-1', alex.id, await saveTree('caretaker-1', 'extra')),
    ).rejects.toMatchObject({ code: 'conflict' })

    // Re-assigning an existing task tree stays a no-op at the limit.
    await recipients.assignTaskTree('caretaker-1', alex.id, 'root-0')
    expect(await recipients.listAssignments('caretaker-1', alex.id)).toHaveLength(
      RECIPIENT_LIMITS.maxAssignmentsPerRecipient,
    )

    await recipients.unassignTaskTree('caretaker-1', alex.id, 'root-0')
    await recipients.unassignTaskTree('caretaker-1', alex.id, 'root-0')
    expect(await recipients.listAssignments('caretaker-1', alex.id)).toHaveLength(
      RECIPIENT_LIMITS.maxAssignmentsPerRecipient - 1,
    )
  })

  test('returns complete assigned task trees without caretaker metadata', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    const shared = await saveTree('caretaker-1', 'root-1', 'child-1')
    await saveTree('caretaker-1', 'root-2')

    expect(await recipients.getAssignedTaskTrees(alex.id)).toEqual([])

    await recipients.assignTaskTree('caretaker-1', alex.id, shared)
    expect(await recipients.getAssignedTaskTrees(alex.id)).toEqual([
      {
        id: shared,
        title: 'Tree root-1',
        // A summary task rolls its single actionable child's duration up.
        durationSeconds: 120,
        children: [{ id: 'child-1', title: 'Child child-1', durationSeconds: 120, children: [] }],
      },
    ])
  })

  test('recognises only the session enrollment activated for an enabled recipient', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    const userId = (
      await database
        .prepare('SELECT userId FROM recipient WHERE id = ?')
        .bind(alex.id)
        .first<{ userId: string }>()
    )?.userId as string
    const session = await recipientAuth.createSession(userId)

    // A session that exists but was never activated is not recognised.
    expect(await recipients.findActiveRecipient(userId, session.id)).toBeNull()

    const enrollments = new EnrollmentService({ database, recipientAuth })
    const issued = await enrollments.issueEnrollment('caretaker-1', alex.id)
    const claim = await enrollments.claimEnrollment({
      payload: issued.payload,
      claimantSecret: 'a'.repeat(43),
    })
    await enrollments.approveEnrollment('caretaker-1', issued.id, {
      matchingCode: claim.matchingCode,
    })

    const active = await database
      .prepare('SELECT activeSessionId FROM recipient WHERE id = ?')
      .bind(alex.id)
      .first<{ activeSessionId: string }>()
    const activeSessionId = active?.activeSessionId as string

    expect(await recipients.findActiveRecipient(userId, activeSessionId)).toMatchObject({
      id: alex.id,
      displayName: 'Alex',
    })
    expect(await recipients.findActiveRecipient(userId, 'some-other-session')).toBeNull()

    // Disabling ends access; re-enabling alone does not restore it.
    await recipients.updateRecipient('caretaker-1', alex.id, { isActive: false })
    expect(await recipients.findActiveRecipient(userId, activeSessionId)).toBeNull()
    await recipients.updateRecipient('caretaker-1', alex.id, { isActive: true })
    expect(await recipients.findActiveRecipient(userId, activeSessionId)).toBeNull()
  })

  test('revoking access keeps the profile and its assignments', async () => {
    const alex = await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })
    const root = await saveTree('caretaker-1', 'root-1')
    await recipients.assignTaskTree('caretaker-1', alex.id, root)
    const enrollments = new EnrollmentService({ database, recipientAuth })
    const issued = await enrollments.issueEnrollment('caretaker-1', alex.id)

    await recipients.revokeRecipientAccess('caretaker-1', alex.id)

    const revoked = await recipients.getRecipient('caretaker-1', alex.id)
    expect(revoked).toMatchObject({
      isActive: true,
      hasActiveSession: false,
      pendingEnrollmentId: null,
    })
    expect(await recipients.listAssignments('caretaker-1', alex.id)).toMatchObject([
      { rootTaskId: root },
    ])
    expect((await enrollments.getEnrollment('caretaker-1', issued.id)).state).toBe('cancelled')
  })
})
