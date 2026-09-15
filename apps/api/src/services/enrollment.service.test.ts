import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ENROLLMENT_TIMINGS } from '@helping-hand/schemas'
import { generateSecret } from '../lib/secrets'
import { createTestDatabase, createTestUser } from '../test/database'
import { cleanupEnrollments, EnrollmentService } from './enrollment.service'
import { RecipientService } from './recipient.service'
import type { RecipientAuth } from './recipient-auth'
import { createRecipientAuth } from './recipient-auth'

const authOptions = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  BETTER_AUTH_URL: 'http://localhost:8787',
  TRUSTED_ORIGIN: 'http://localhost:5173',
}

const PAST = '2020-01-01T00:00:00.000Z'

describe('EnrollmentService', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database
  let recipientAuth: RecipientAuth
  let recipients: RecipientService
  let enrollments: EnrollmentService
  let recipientId: string

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
    await createTestUser(database, 'caretaker-1')
    await createTestUser(database, 'caretaker-2')
    recipientAuth = createRecipientAuth({ database, ...authOptions })
    recipients = new RecipientService({ database, recipientAuth })
    enrollments = new EnrollmentService({ database, recipientAuth })
    recipientId = (await recipients.createRecipient('caretaker-1', { displayName: 'Alex' })).id
  })

  afterEach(async () => miniflare.dispose())

  /** Runs the handshake up to the point a confirmation code exists. */
  async function claimed() {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)
    const claimantSecret = generateSecret()
    const claim = await enrollments.claimEnrollment({ payload: issued.payload, claimantSecret })
    return { issued, claimantSecret, matchingCode: claim.matchingCode }
  }

  const expire = (enrollmentId: string, column: 'expiresAt' | 'deliveryExpiresAt') =>
    database
      .prepare(`UPDATE enrollment SET ${column} = ? WHERE id = ?`)
      .bind(PAST, enrollmentId)
      .run()

  test('cleanup settles stale enrollments and deletes the session nobody collected', async () => {
    const { issued, matchingCode } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    const approvedSessionId = await database
      .prepare('SELECT approvedSessionId FROM enrollment WHERE id = ?')
      .bind(issued.id)
      .first<{ approvedSessionId: string }>()
    await expire(issued.id, 'deliveryExpiresAt')

    const swept = await cleanupEnrollments(database)

    expect(swept.enrollmentsExpired).toBe(1)
    expect(swept.sessionsDeleted).toBe(1)
    expect(
      await database
        .prepare('SELECT state FROM enrollment WHERE id = ?')
        .bind(issued.id)
        .first<{ state: string }>(),
    ).toMatchObject({ state: 'expired' })
    expect(
      await database
        .prepare('SELECT id FROM session WHERE id = ?')
        .bind(approvedSessionId?.approvedSessionId ?? '')
        .first(),
    ).toBeNull()
  })

  test('cleanup clears a delivered token without ending the active session', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    const session = await enrollments.collectSession(issued.id, { claimantSecret })
    if ('state' in session) throw new Error('Expected an approved session')
    const active = await database
      .prepare('SELECT activeSessionId FROM recipient WHERE id = ?')
      .bind(recipientId)
      .first<{ activeSessionId: string }>()
    await expire(issued.id, 'deliveryExpiresAt')

    await cleanupEnrollments(database)

    expect(
      await database
        .prepare('SELECT state, approvedSessionToken FROM enrollment WHERE id = ?')
        .bind(issued.id)
        .first(),
    ).toMatchObject({ state: 'delivered', approvedSessionToken: null })
    expect(
      await database
        .prepare('SELECT id FROM session WHERE id = ?')
        .bind(active?.activeSessionId ?? '')
        .first(),
    ).not.toBeNull()
  })

  test('cleanup reports the delivered tokens it cleared', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    await enrollments.collectSession(issued.id, { claimantSecret })
    await expire(issued.id, 'deliveryExpiresAt')

    expect((await cleanupEnrollments(database)).tokensCleared).toBe(1)
  })

  test('a collection past the delivery window drops the stored token at once', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    await enrollments.collectSession(issued.id, { claimantSecret })
    await expire(issued.id, 'deliveryExpiresAt')

    await expect(enrollments.collectSession(issued.id, { claimantSecret })).rejects.toMatchObject({
      code: 'expired',
    })
    // The plaintext copy cannot wait for the scheduled sweep.
    expect(
      await database
        .prepare('SELECT state, approvedSessionToken FROM enrollment WHERE id = ?')
        .bind(issued.id)
        .first(),
    ).toMatchObject({ state: 'delivered', approvedSessionToken: null })
  })

  test('redelivery inside the delivery window keeps the stored token', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    const first = await enrollments.collectSession(issued.id, { claimantSecret })
    const second = await enrollments.collectSession(issued.id, { claimantSecret })

    if ('state' in first || 'state' in second) throw new Error('Expected an approved session')
    expect(second.token).toBe(first.token)
  })

  test('cleanup deletes settled enrollments only once they are past retention', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)
    await enrollments.cancelEnrollment('caretaker-1', issued.id)

    expect((await cleanupEnrollments(database)).enrollmentsDeleted).toBe(0)

    await database
      .prepare('UPDATE enrollment SET updatedAt = ? WHERE id = ?')
      .bind(PAST, issued.id)
      .run()

    expect((await cleanupEnrollments(database)).enrollmentsDeleted).toBe(1)
    expect(
      await database.prepare('SELECT id FROM enrollment WHERE id = ?').bind(issued.id).first(),
    ).toBeNull()
  })

  test('issues a versioned payload with a fresh secret and expiry', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)

    expect(issued.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(issued.state).toBe('issued')
    expect(issued.payload).toMatchObject({ version: 1, enrollmentId: issued.id })
    expect(issued.payload.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(
      (ENROLLMENT_TIMINGS.claimSeconds - 30) * 1000,
    )
    // The stored state never exposes a secret to the caretaker.
    expect(await enrollments.getEnrollment('caretaker-1', issued.id)).toEqual({
      id: issued.id,
      recipientId,
      state: 'issued',
      matchingCode: null,
      expiresAt: issued.expiresAt,
    })
  })

  test('refuses to issue for another caretaker or a disabled recipient', async () => {
    expect(enrollments.issueEnrollment('caretaker-2', recipientId)).rejects.toMatchObject({
      code: 'not_found',
    })

    await recipients.updateRecipient('caretaker-1', recipientId, { isActive: false })
    expect(enrollments.issueEnrollment('caretaker-1', recipientId)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  test('cancels the previous open enrollment when a new one is issued', async () => {
    const first = await claimed()

    const second = await enrollments.issueEnrollment('caretaker-1', recipientId)

    expect((await enrollments.getEnrollment('caretaker-1', first.issued.id)).state).toBe(
      'cancelled',
    )
    expect((await enrollments.getEnrollment('caretaker-1', second.id)).state).toBe('issued')
    expect(
      enrollments.approveEnrollment('caretaker-1', first.issued.id, {
        matchingCode: first.matchingCode,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  test('binds the first claimant and lets only that claimant repeat the request', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)
    const winner = generateSecret()

    const first = await enrollments.claimEnrollment({
      payload: issued.payload,
      claimantSecret: winner,
    })
    const winningCode = first.matchingCode
    expect(winningCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(first.enrollmentId).toBe(issued.id)
    expect(first.pollIntervalSeconds).toBe(ENROLLMENT_TIMINGS.pollIntervalSeconds)

    const repeat = await enrollments.claimEnrollment({
      payload: issued.payload,
      claimantSecret: winner,
    })
    expect(repeat.matchingCode).toBe(winningCode)

    expect(
      enrollments.claimEnrollment({ payload: issued.payload, claimantSecret: generateSecret() }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  test('treats a wrong QR secret and an unknown enrollment as the same failure', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)

    expect(
      enrollments.claimEnrollment({
        payload: { ...issued.payload, secret: generateSecret() },
        claimantSecret: generateSecret(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      enrollments.claimEnrollment({
        payload: { ...issued.payload, enrollmentId: crypto.randomUUID() },
        claimantSecret: generateSecret(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('rejects a malformed payload version and secret before touching state', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)

    expect(
      enrollments.claimEnrollment({
        payload: { ...issued.payload, version: 2 as 1 },
        claimantSecret: generateSecret(),
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(
      enrollments.claimEnrollment({ payload: issued.payload, claimantSecret: 'too-short' }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect((await enrollments.getEnrollment('caretaker-1', issued.id)).state).toBe('issued')
  })

  test('expires an unclaimed enrollment and never reopens it for another claimant', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)
    await expire(issued.id, 'expiresAt')

    expect(
      enrollments.claimEnrollment({ payload: issued.payload, claimantSecret: generateSecret() }),
    ).rejects.toMatchObject({ code: 'expired' })
    expect((await enrollments.getEnrollment('caretaker-1', issued.id)).state).toBe('expired')

    // A settled enrollment stops blocking the next one.
    const replacement = await enrollments.issueEnrollment('caretaker-1', recipientId)
    expect(replacement.id).not.toBe(issued.id)
  })

  test('fails approval on a mismatched code and on an enrollment awaiting a claim', async () => {
    const issued = await enrollments.issueEnrollment('caretaker-1', recipientId)
    expect(
      enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode: 'ABCDEF' }),
    ).rejects.toMatchObject({ code: 'conflict' })

    const { issued: second, matchingCode, claimantSecret } = await claimed()
    expect(
      enrollments.approveEnrollment('caretaker-1', second.id, { matchingCode: 'ABCDEF' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(
      enrollments.approveEnrollment('caretaker-2', second.id, { matchingCode }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      enrollments.approveEnrollment('caretaker-1', second.id, { matchingCode: 'no' }),
    ).rejects.toMatchObject({ code: 'invalid' })

    // None of those failures granted anything to the waiting device.
    const pending = await enrollments.collectSession(second.id, { claimantSecret })
    expect(pending).toMatchObject({ state: 'claimed' })
  })

  test('approves once and repeats the same outcome for a retried approval', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()

    const approved = await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    expect(approved).toMatchObject({ id: issued.id, recipientId, state: 'approved', matchingCode })

    const retried = await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })
    expect(retried.state).toBe('approved')

    const session = await enrollments.collectSession(issued.id, { claimantSecret })
    expect(session).toMatchObject({
      tokenType: 'Bearer',
      recipient: { id: recipientId, displayName: 'Alex' },
    })
    // Exactly one session was activated across both approvals.
    const active = await recipients.getRecipient('caretaker-1', recipientId)
    expect(active.hasActiveSession).toBe(true)
  })

  test('refuses a wrong confirmation code even after the enrollment was approved', async () => {
    const { issued, matchingCode } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })

    // The retry path must not accept a code the caretaker never confirmed.
    expect(
      enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode: 'ABCDEF' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  test('delivers only to the bound claimant and redelivers until the window closes', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()
    await enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode })

    const first = await enrollments.collectSession(issued.id, { claimantSecret })
    const second = await enrollments.collectSession(issued.id, { claimantSecret })
    expect('token' in first && 'token' in second && first.token === second.token).toBe(true)

    expect(
      enrollments.collectSession(issued.id, { claimantSecret: generateSecret() }),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expire(issued.id, 'deliveryExpiresAt')
    expect(enrollments.collectSession(issued.id, { claimantSecret })).rejects.toMatchObject({
      code: 'expired',
    })
    // Closing the delivery window does not revoke the session it already activated.
    expect((await recipients.getRecipient('caretaker-1', recipientId)).hasActiveSession).toBe(true)
  })

  test('replaces the previous device and keeps a single active session', async () => {
    const original = await claimed()
    await enrollments.approveEnrollment('caretaker-1', original.issued.id, {
      matchingCode: original.matchingCode,
    })
    const originalSession = await enrollments.collectSession(original.issued.id, {
      claimantSecret: original.claimantSecret,
    })

    if (!('token' in originalSession)) throw new Error('Expected a delivered session')
    const originalSessionId = await activeSessionId()
    const userId = await recipientUserId()

    // The original device keeps access while a replacement is prepared.
    const replacement = await claimed()
    expect(await recipients.findActiveRecipient(userId, originalSessionId)).not.toBeNull()

    await enrollments.approveEnrollment('caretaker-1', replacement.issued.id, {
      matchingCode: replacement.matchingCode,
    })
    const newSession = await enrollments.collectSession(replacement.issued.id, {
      claimantSecret: replacement.claimantSecret,
    })
    if (!('token' in newSession)) throw new Error('Expected a delivered session')

    expect(newSession.token).not.toBe(originalSession.token)
    // Approval moved the active-session reference and left only one session.
    expect(await recipients.findActiveRecipient(userId, originalSessionId)).toBeNull()
    expect(await recipients.findActiveRecipient(userId, await activeSessionId())).toMatchObject({
      id: recipientId,
    })
  })

  test('cancelling stops approval but keeps the recipient and its identity', async () => {
    const { issued, matchingCode, claimantSecret } = await claimed()

    await enrollments.cancelEnrollment('caretaker-1', issued.id)

    expect((await enrollments.getEnrollment('caretaker-1', issued.id)).state).toBe('cancelled')
    expect(
      enrollments.approveEnrollment('caretaker-1', issued.id, { matchingCode }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(enrollments.collectSession(issued.id, { claimantSecret })).rejects.toMatchObject({
      code: 'expired',
    })
    expect(await recipients.getRecipient('caretaker-1', recipientId)).toMatchObject({
      isActive: true,
      hasActiveSession: false,
    })
    expect(enrollments.cancelEnrollment('caretaker-2', issued.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  const recipientUserId = async () =>
    (
      await database
        .prepare('SELECT userId FROM recipient WHERE id = ?')
        .bind(recipientId)
        .first<{ userId: string }>()
    )?.userId as string

  const activeSessionId = async () =>
    (
      await database
        .prepare('SELECT activeSessionId FROM recipient WHERE id = ?')
        .bind(recipientId)
        .first<{ activeSessionId: string }>()
    )?.activeSessionId as string
})
