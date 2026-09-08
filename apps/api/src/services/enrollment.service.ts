import {
  type ApproveEnrollmentInput,
  approveEnrollmentInputSchema,
  type ClaimEnrollmentInput,
  type CollectEnrollmentInput,
  claimEnrollmentInputSchema,
  collectEnrollmentInputSchema,
  ENROLLMENT_PAYLOAD_VERSION,
  ENROLLMENT_TIMINGS,
  type EnrollmentClaim,
  type EnrollmentState,
  type EnrollmentStatus,
  type IssuedEnrollment,
  type PendingEnrollmentSession,
  type RecipientSession,
} from '@helping-hand/schemas'
import { generateMatchingCode } from '../lib/matching-code'
import { constantTimeEquals, generateSecret, hashSecret } from '../lib/secrets'
import { SQL_NOW } from '../lib/sql'
import type { RecipientAuth } from './recipient-auth'

/**
 * The states in which an enrollment still holds a claim on its recipient. The
 * partial unique index allows only one of these per recipient at a time.
 */
export const OPEN_ENROLLMENT_STATES = "('issued', 'claimed', 'approved')"
const STALE_SWEEP_LIMIT = 100

/** How long a settled enrollment is kept before its record is removed. */
const SETTLED_RETENTION = '-30 days'
/** Rows touched per cleanup statement, so one sweep can never run unbounded. */
const CLEANUP_LIMIT = 500

/**
 * A matching code is only worth showing while both devices are still waiting on
 * it. Once the enrollment settles it is stale, so it is withheld.
 */
const CODE_VISIBLE_STATES = new Set(['claimed', 'approved'])

type EnrollmentServiceOptions = {
  database: D1Database
  recipientAuth: RecipientAuth
}

type EnrollmentRow = {
  id: string
  recipientId: string
  caretakerId: string
  qrSecretHash: string
  claimantSecretHash: string | null
  matchingCode: string | null
  state: EnrollmentState
  expiresAt: string
  deliveryExpiresAt: string | null
  approvedSessionId: string | null
  approvedSessionToken: string | null
}

export class EnrollmentServiceError extends Error {
  constructor(
    readonly code: 'invalid' | 'not_found' | 'conflict' | 'expired',
    message: string,
  ) {
    super(message)
  }
}

const seconds = (from: Date, count: number) => new Date(from.getTime() + count * 1000).toISOString()

/**
 * Closes every enrollment still open for a recipient. Recipient revocation and
 * a newly issued QR both need this, so enrollment owns it rather than letting
 * the SQL spread across modules.
 */
export function cancelOpenEnrollments(database: D1Database, recipientId: string) {
  return database
    .prepare(
      `UPDATE enrollment
         SET state = 'cancelled', approvedSessionToken = NULL, updatedAt = ${SQL_NOW}
         WHERE recipientId = ? AND state IN ${OPEN_ENROLLMENT_STATES}`,
    )
    .bind(recipientId)
}

/**
 * Expiry is enforced by every conditional write. This only settles the stored
 * state so an abandoned enrollment stops blocking the next one. Without an
 * enrollment it sweeps a bounded batch of whatever has gone stale.
 */
export function expireStaleStatement(database: D1Database, enrollmentId?: string) {
  const filter = enrollmentId
    ? { clause: 'id = ?', value: enrollmentId }
    : {
        clause: `id IN (SELECT id FROM enrollment WHERE state IN ${OPEN_ENROLLMENT_STATES} LIMIT ${STALE_SWEEP_LIMIT})`,
        value: null,
      }

  const statement = database.prepare(
    `UPDATE enrollment
       SET state = 'expired', approvedSessionToken = NULL, updatedAt = ${SQL_NOW}
       WHERE ${filter.clause}
         AND (
           (state IN ('issued', 'claimed') AND expiresAt <= ${SQL_NOW})
           OR (state = 'approved' AND deliveryExpiresAt <= ${SQL_NOW})
         )`,
  )
  return filter.value === null ? statement : statement.bind(filter.value)
}

/**
 * The periodic sweep behind the scheduled handler. It settles stale
 * enrollments, deletes the sessions prepared for enrollments that were never
 * collected, and drops settled records once their retention window passes.
 * Every statement is bounded, so a large backlog drains over several runs.
 */
export async function cleanupEnrollments(database: D1Database) {
  const [expired, sessions, , records] = await database.batch([
    expireStaleStatement(database),

    // An approved enrollment that expired or was cancelled leaves behind a
    // session no device ever collected. A delivered enrollment is a different
    // state, so a session in use is never reached from here.
    database
      .prepare(
        `DELETE FROM session
           WHERE id IN (
             SELECT approvedSessionId FROM enrollment
               WHERE state IN ('cancelled', 'expired') AND approvedSessionId IS NOT NULL
               LIMIT ?
           )`,
      )
      .bind(CLEANUP_LIMIT),

    // The recipient still points at the session that was just removed.
    database.prepare(
      `UPDATE recipient
         SET activeSessionId = NULL, updatedAt = ${SQL_NOW}
         WHERE activeSessionId IS NOT NULL
           AND activeSessionId NOT IN (SELECT id FROM session)`,
    ),

    database
      .prepare(
        `DELETE FROM enrollment
           WHERE id IN (
             SELECT id FROM enrollment
               WHERE state IN ('delivered', 'cancelled', 'expired')
                 AND updatedAt <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
               LIMIT ?
           )`,
      )
      .bind(SETTLED_RETENTION, CLEANUP_LIMIT),
  ])

  return {
    enrollmentsExpired: expired.meta.changes ?? 0,
    sessionsDeleted: sessions.meta.changes ?? 0,
    enrollmentsDeleted: records.meta.changes ?? 0,
  }
}

/**
 * Owns the enrollment state machine: secrets, expiry, matching codes,
 * concurrent claims, session activation, device replacement, and recovery from
 * lost responses.
 */
export class EnrollmentService {
  readonly #database: D1Database
  readonly #recipientAuth: RecipientAuth

  constructor({ database, recipientAuth }: EnrollmentServiceOptions) {
    this.#database = database
    this.#recipientAuth = recipientAuth
  }

  async #expireStale(enrollmentId: string) {
    await expireStaleStatement(this.#database, enrollmentId).run()
  }

  async #enrollment(enrollmentId: string): Promise<EnrollmentRow | null> {
    return this.#database
      .prepare(
        `SELECT id, recipientId, caretakerId, qrSecretHash, claimantSecretHash, matchingCode,
                state, expiresAt, deliveryExpiresAt, approvedSessionId, approvedSessionToken
           FROM enrollment WHERE id = ?`,
      )
      .bind(enrollmentId)
      .first<EnrollmentRow>()
  }

  async #ownedEnrollment(caretakerId: string, enrollmentId: string): Promise<EnrollmentRow> {
    await this.#expireStale(enrollmentId)
    const enrollment = await this.#enrollment(enrollmentId)
    if (!enrollment || enrollment.caretakerId !== caretakerId) {
      throw new EnrollmentServiceError('not_found', 'Enrollment does not exist')
    }
    return enrollment
  }

  async issueEnrollment(caretakerId: string, recipientId: string): Promise<IssuedEnrollment> {
    const recipient = await this.#database
      .prepare('SELECT id, isActive FROM recipient WHERE id = ? AND caretakerId = ?')
      .bind(recipientId, caretakerId)
      .first<{ id: string; isActive: number }>()
    if (!recipient) throw new EnrollmentServiceError('not_found', 'Recipient does not exist')
    if (recipient.isActive !== 1) {
      throw new EnrollmentServiceError('conflict', 'A disabled recipient cannot be enrolled')
    }

    const id = crypto.randomUUID()
    const secret = generateSecret()
    const now = new Date()
    const expiresAt = seconds(now, ENROLLMENT_TIMINGS.claimSeconds)

    // Issuing cancels any open enrollment for this recipient in the same batch,
    // so the partial unique index can never see two open rows.
    await this.#database.batch([
      expireStaleStatement(this.#database),
      cancelOpenEnrollments(this.#database, recipientId),
      this.#database
        .prepare(
          `INSERT INTO enrollment (id, recipientId, caretakerId, qrSecretHash, state, expiresAt)
             VALUES (?, ?, ?, ?, 'issued', ?)`,
        )
        .bind(id, recipientId, caretakerId, await hashSecret(secret), expiresAt),
    ])

    return {
      id,
      state: 'issued',
      payload: { version: ENROLLMENT_PAYLOAD_VERSION, enrollmentId: id, secret },
      expiresAt,
    }
  }

  async getEnrollment(caretakerId: string, enrollmentId: string): Promise<EnrollmentStatus> {
    const enrollment = await this.#ownedEnrollment(caretakerId, enrollmentId)
    return {
      id: enrollment.id,
      recipientId: enrollment.recipientId,
      state: enrollment.state,
      matchingCode: CODE_VISIBLE_STATES.has(enrollment.state) ? enrollment.matchingCode : null,
      expiresAt: enrollment.expiresAt,
    }
  }

  async cancelEnrollment(caretakerId: string, enrollmentId: string): Promise<void> {
    const enrollment = await this.#ownedEnrollment(caretakerId, enrollmentId)
    await this.#database
      .prepare(
        `UPDATE enrollment
           SET state = 'cancelled', approvedSessionToken = NULL, updatedAt = ${SQL_NOW}
           WHERE id = ? AND state IN ${OPEN_ENROLLMENT_STATES}`,
      )
      .bind(enrollment.id)
      .run()
  }

  async claimEnrollment(input: ClaimEnrollmentInput): Promise<EnrollmentClaim> {
    const parsed = claimEnrollmentInputSchema.safeParse(input)
    if (!parsed.success) throw new EnrollmentServiceError('invalid', 'Invalid enrollment claim')
    const { payload, claimantSecret } = parsed.data

    await this.#expireStale(payload.enrollmentId)
    const qrSecretHash = await hashSecret(payload.secret)
    const claimantSecretHash = await hashSecret(claimantSecret)
    const matchingCode = generateMatchingCode()
    const now = new Date().toISOString()

    const claimed = await this.#database
      .prepare(
        `UPDATE enrollment
           SET state = 'claimed', claimantSecretHash = ?, matchingCode = ?, updatedAt = ${SQL_NOW}
           WHERE id = ? AND qrSecretHash = ? AND state = 'issued' AND expiresAt > ${SQL_NOW}
           RETURNING matchingCode, expiresAt`,
      )
      .bind(claimantSecretHash, matchingCode, payload.enrollmentId, qrSecretHash)
      .first<{ matchingCode: string; expiresAt: string }>()

    if (claimed) {
      return {
        enrollmentId: payload.enrollmentId,
        matchingCode: claimed.matchingCode,
        expiresAt: claimed.expiresAt,
        pollIntervalSeconds: ENROLLMENT_TIMINGS.pollIntervalSeconds,
      }
    }

    const enrollment = await this.#enrollment(payload.enrollmentId)
    // An invalid claimant learns nothing about the recipient or the enrollment.
    if (!enrollment || !constantTimeEquals(enrollment.qrSecretHash, qrSecretHash)) {
      throw new EnrollmentServiceError('not_found', 'Enrollment does not exist')
    }
    // The winning claimant may repeat its own request after a lost response.
    if (
      constantTimeEquals(enrollment.claimantSecretHash, claimantSecretHash) &&
      enrollment.matchingCode
    ) {
      return {
        enrollmentId: enrollment.id,
        matchingCode: enrollment.matchingCode,
        expiresAt: enrollment.expiresAt,
        pollIntervalSeconds: ENROLLMENT_TIMINGS.pollIntervalSeconds,
      }
    }
    if (enrollment.state === 'expired' || enrollment.expiresAt <= now) {
      throw new EnrollmentServiceError('expired', 'The enrollment has expired')
    }
    throw new EnrollmentServiceError('conflict', 'The enrollment was already claimed')
  }

  async approveEnrollment(
    caretakerId: string,
    enrollmentId: string,
    input: ApproveEnrollmentInput,
  ): Promise<EnrollmentStatus> {
    const parsed = approveEnrollmentInputSchema.safeParse(input)
    if (!parsed.success) throw new EnrollmentServiceError('invalid', 'Invalid approval')
    const enrollment = await this.#ownedEnrollment(caretakerId, enrollmentId)

    if (!constantTimeEquals(enrollment.matchingCode, parsed.data.matchingCode)) {
      throw new EnrollmentServiceError('conflict', 'The confirmation code does not match')
    }
    // Repeating an approval never creates a second active session.
    if (enrollment.state === 'approved' || enrollment.state === 'delivered') {
      return this.getEnrollment(caretakerId, enrollmentId)
    }
    if (enrollment.state !== 'claimed') {
      throw new EnrollmentServiceError('conflict', 'The enrollment is not awaiting approval')
    }

    const recipient = await this.#database
      .prepare('SELECT userId, isActive FROM recipient WHERE id = ?')
      .bind(enrollment.recipientId)
      .first<{ userId: string; isActive: number }>()
    if (recipient?.isActive !== 1) {
      throw new EnrollmentServiceError('conflict', 'A disabled recipient cannot be enrolled')
    }

    // The session exists before activation but is unusable: recipient requests
    // are rejected until the recipient's active-session reference names it.
    const session = await this.#recipientAuth.createSession(recipient.userId)
    const deliveryExpiresAt = seconds(new Date(), ENROLLMENT_TIMINGS.deliverySeconds)

    const [approval] = await this.#database.batch([
      this.#database
        .prepare(
          `UPDATE enrollment
             SET state = 'approved', approvedSessionId = ?, approvedSessionToken = ?,
                 deliveryExpiresAt = ?, updatedAt = ${SQL_NOW}
             WHERE id = ? AND state = 'claimed' AND matchingCode = ? AND expiresAt > ${SQL_NOW}`,
        )
        .bind(session.id, session.token, deliveryExpiresAt, enrollmentId, parsed.data.matchingCode),
      // Activation and revocation of the previous device happen only if the
      // guarded approval above actually won.
      this.#database
        .prepare(
          `UPDATE recipient
             SET activeSessionId = ?, updatedAt = ${SQL_NOW}
             WHERE id = ?
               AND EXISTS (
                 SELECT 1 FROM enrollment
                   WHERE id = ? AND state = 'approved' AND approvedSessionId = ?
               )`,
        )
        .bind(session.id, enrollment.recipientId, enrollmentId, session.id),
      this.#database
        .prepare(
          `DELETE FROM session
             WHERE userId = ? AND id <> ?
               AND EXISTS (
                 SELECT 1 FROM enrollment
                   WHERE id = ? AND state = 'approved' AND approvedSessionId = ?
               )`,
        )
        .bind(recipient.userId, session.id, enrollmentId, session.id),
    ])

    if (approval.meta.changes === 0) {
      // This approval lost a race. Its prepared session was never activated.
      await this.#database.prepare('DELETE FROM session WHERE id = ?').bind(session.id).run()
      const settled = await this.#enrollment(enrollmentId)
      const alreadyApproved = settled?.state === 'approved' || settled?.state === 'delivered'
      if (!alreadyApproved || !constantTimeEquals(settled.matchingCode, parsed.data.matchingCode)) {
        throw new EnrollmentServiceError(
          'conflict',
          'The enrollment is no longer awaiting approval',
        )
      }
    }

    return this.getEnrollment(caretakerId, enrollmentId)
  }

  /**
   * Returns the approved session to the bound claimant, or reports that
   * approval is still pending. The same session is redelivered after a lost
   * response until the delivery window closes.
   */
  async collectSession(
    enrollmentId: string,
    input: CollectEnrollmentInput,
  ): Promise<RecipientSession | PendingEnrollmentSession> {
    const parsed = collectEnrollmentInputSchema.safeParse(input)
    if (!parsed.success) throw new EnrollmentServiceError('invalid', 'Invalid collection request')

    await this.#expireStale(enrollmentId)
    const enrollment = await this.#enrollment(enrollmentId)
    const claimantSecretHash = await hashSecret(parsed.data.claimantSecret)
    if (!enrollment || !constantTimeEquals(enrollment.claimantSecretHash, claimantSecretHash)) {
      throw new EnrollmentServiceError('not_found', 'Enrollment does not exist')
    }

    const now = new Date().toISOString()
    if (enrollment.state === 'claimed') {
      if (enrollment.expiresAt <= now) {
        throw new EnrollmentServiceError('expired', 'The enrollment has expired')
      }
      return {
        state: 'claimed',
        pollIntervalSeconds: ENROLLMENT_TIMINGS.pollIntervalSeconds,
        expiresAt: enrollment.expiresAt,
      }
    }

    const deliverable = enrollment.state === 'approved' || enrollment.state === 'delivered'
    if (!deliverable || !enrollment.approvedSessionToken) {
      throw new EnrollmentServiceError('expired', 'The enrollment can no longer be collected')
    }
    if ((enrollment.deliveryExpiresAt ?? now) <= now) {
      throw new EnrollmentServiceError('expired', 'The approved session can no longer be collected')
    }

    const recipient = await this.#database
      .prepare('SELECT displayName FROM recipient WHERE id = ?')
      .bind(enrollment.recipientId)
      .first<{ displayName: string }>()
    if (!recipient) throw new EnrollmentServiceError('not_found', 'Enrollment does not exist')

    const session = await this.#database
      .prepare('SELECT expiresAt FROM session WHERE id = ?')
      .bind(enrollment.approvedSessionId)
      .first<{ expiresAt: string | number }>()
    if (!session) {
      throw new EnrollmentServiceError('expired', 'The approved session is no longer available')
    }

    await this.#database
      .prepare(
        `UPDATE enrollment SET state = 'delivered', updatedAt = ${SQL_NOW}
           WHERE id = ? AND state = 'approved'`,
      )
      .bind(enrollmentId)
      .run()

    return {
      token: enrollment.approvedSessionToken,
      tokenType: 'Bearer',
      expiresAt: new Date(session.expiresAt).toISOString(),
      recipient: { id: enrollment.recipientId, displayName: recipient.displayName },
    }
  }
}
