import {
  type CreateRecipientInput,
  createRecipientInputSchema,
  RECIPIENT_LIMITS,
  type Recipient,
  type RecipientAssignment,
  type TaskNode,
  type UpdateRecipientInput,
  updateRecipientInputSchema,
} from '@helping-hand/schemas'
import { SQL_NOW } from '../lib/sql'
import { cancelOpenEnrollments, OPEN_ENROLLMENT_STATES } from './enrollment.service'
import type { RecipientAuth } from './recipient-auth'
import { buildTaskTrees, TASK_TREE_COLUMNS, type TaskRow } from './task-tree'

/** Recipient columns plus the derived status a caretaker sees. */
const RECIPIENT_COLUMNS = `recipient.id, recipient.userId, recipient.displayName, recipient.isActive,
        recipient.activeSessionId, recipient.createdAt, recipient.updatedAt,
        EXISTS (
          SELECT 1 FROM session WHERE session.id = recipient.activeSessionId
        ) AS hasActiveSession,
        (
          SELECT enrollment.id FROM enrollment
            WHERE enrollment.recipientId = recipient.id
              AND enrollment.state IN ${OPEN_ENROLLMENT_STATES}
            LIMIT 1
        ) AS pendingEnrollmentId`

type RecipientServiceOptions = {
  database: D1Database
  recipientAuth: RecipientAuth
}

type RecipientRow = {
  id: string
  userId: string
  displayName: string
  isActive: number
  activeSessionId: string | null
  createdAt: string
  updatedAt: string
}

type RecipientListRow = RecipientRow & {
  hasActiveSession: number
  pendingEnrollmentId: string | null
}

/** A recipient whose device session is currently the recipient's active one. */
export type ActiveRecipient = {
  id: string
  userId: string
  displayName: string
}

export class RecipientServiceError extends Error {
  constructor(
    readonly code: 'invalid' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message)
  }
}

function toRecipient(row: RecipientListRow): Recipient {
  return {
    id: row.id,
    displayName: row.displayName,
    isActive: row.isActive === 1,
    hasActiveSession: row.hasActiveSession === 1,
    pendingEnrollmentId: row.pendingEnrollmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Owns recipient lifecycle, caretaker ownership, task assignment rules, and the
 * access-scoped reads a signed-in recipient device is allowed to perform.
 */
export class RecipientService {
  readonly #database: D1Database
  readonly #recipientAuth: RecipientAuth

  constructor({ database, recipientAuth }: RecipientServiceOptions) {
    this.#database = database
    this.#recipientAuth = recipientAuth
  }

  /**
   * Statements that end every form of recipient access: the device sessions,
   * the active-session reference, and any enrollment still in flight. Used by
   * explicit revocation, disabling, and replacement clean-up.
   */
  #revocationStatements(recipient: Pick<RecipientRow, 'id' | 'userId'>) {
    return [
      this.#database.prepare('DELETE FROM session WHERE userId = ?').bind(recipient.userId),
      this.#database
        .prepare(
          `UPDATE recipient
             SET activeSessionId = NULL, updatedAt = ${SQL_NOW}
             WHERE id = ?`,
        )
        .bind(recipient.id),
      cancelOpenEnrollments(this.#database, recipient.id),
    ]
  }

  async #ownedRecipient(caretakerId: string, recipientId: string): Promise<RecipientRow> {
    const recipient = await this.#database
      .prepare(
        `SELECT id, userId, displayName, isActive, activeSessionId, createdAt, updatedAt
           FROM recipient WHERE id = ? AND caretakerId = ?`,
      )
      .bind(recipientId, caretakerId)
      .first<RecipientRow>()
    if (!recipient) throw new RecipientServiceError('not_found', 'Recipient does not exist')
    return recipient
  }

  async createRecipient(caretakerId: string, input: CreateRecipientInput): Promise<Recipient> {
    const parsed = createRecipientInputSchema.safeParse(input)
    if (!parsed.success) throw new RecipientServiceError('invalid', 'Invalid recipient')
    const displayName = parsed.data.displayName.trim()

    const existing = await this.#database
      .prepare('SELECT COUNT(*) AS total FROM recipient WHERE caretakerId = ?')
      .bind(caretakerId)
      .first<{ total: number }>()
    if ((existing?.total ?? 0) >= RECIPIENT_LIMITS.maxRecipientsPerCaretaker) {
      throw new RecipientServiceError(
        'conflict',
        `A caretaker cannot have more than ${RECIPIENT_LIMITS.maxRecipientsPerCaretaker} recipients`,
      )
    }

    const userId = await this.#recipientAuth.createRecipientUser(displayName)
    const id = crypto.randomUUID()
    try {
      await this.#database
        .prepare('INSERT INTO recipient (id, userId, caretakerId, displayName) VALUES (?, ?, ?, ?)')
        .bind(id, userId, caretakerId, displayName)
        .run()
    } catch (error) {
      // The identity is useless without its profile and must not linger.
      await this.#recipientAuth.deleteUser(userId)
      throw error
    }

    return this.getRecipient(caretakerId, id)
  }

  async getRecipient(caretakerId: string, recipientId: string): Promise<Recipient> {
    const row = await this.#database
      .prepare(
        `SELECT ${RECIPIENT_COLUMNS}
           FROM recipient WHERE recipient.id = ? AND recipient.caretakerId = ?`,
      )
      .bind(recipientId, caretakerId)
      .first<RecipientListRow>()
    if (!row) throw new RecipientServiceError('not_found', 'Recipient does not exist')
    return toRecipient(row)
  }

  async listRecipients(caretakerId: string): Promise<Recipient[]> {
    const { results } = await this.#database
      .prepare(
        `SELECT ${RECIPIENT_COLUMNS}
           FROM recipient
           WHERE recipient.caretakerId = ?
           ORDER BY recipient.createdAt, recipient.id`,
      )
      .bind(caretakerId)
      .all<RecipientListRow>()
    return results.map(toRecipient)
  }

  async updateRecipient(
    caretakerId: string,
    recipientId: string,
    input: UpdateRecipientInput,
  ): Promise<Recipient> {
    const parsed = updateRecipientInputSchema.safeParse(input)
    if (!parsed.success) throw new RecipientServiceError('invalid', 'Invalid recipient update')
    const recipient = await this.#ownedRecipient(caretakerId, recipientId)
    const { displayName, isActive } = parsed.data

    const statements = [
      this.#database
        .prepare(
          `UPDATE recipient
             SET displayName = COALESCE(?, displayName),
                 isActive = COALESCE(?, isActive),
                 updatedAt = ${SQL_NOW}
             WHERE id = ? AND caretakerId = ?`,
        )
        .bind(
          displayName?.trim() ?? null,
          isActive === undefined ? null : isActive ? 1 : 0,
          recipientId,
          caretakerId,
        ),
      // Disabling revokes access. Re-enabling alone never restores a session.
      ...(isActive === false ? this.#revocationStatements(recipient) : []),
    ]
    await this.#database.batch(statements)
    return this.getRecipient(caretakerId, recipientId)
  }

  async deleteRecipient(caretakerId: string, recipientId: string): Promise<void> {
    const recipient = await this.#ownedRecipient(caretakerId, recipientId)
    await this.#recipientAuth.deleteUser(recipient.userId)
  }

  async revokeRecipientAccess(caretakerId: string, recipientId: string): Promise<void> {
    const recipient = await this.#ownedRecipient(caretakerId, recipientId)
    await this.#database.batch(this.#revocationStatements(recipient))
  }

  async listAssignments(caretakerId: string, recipientId: string): Promise<RecipientAssignment[]> {
    await this.#ownedRecipient(caretakerId, recipientId)
    const { results } = await this.#database
      .prepare(
        `SELECT rootTaskId, createdAt FROM task_assignment
           WHERE recipientId = ? AND caretakerId = ?
           ORDER BY createdAt, rootTaskId`,
      )
      .bind(recipientId, caretakerId)
      .all<RecipientAssignment>()
    return results
  }

  async assignTaskTree(
    caretakerId: string,
    recipientId: string,
    rootTaskId: string,
  ): Promise<void> {
    await this.#ownedRecipient(caretakerId, recipientId)
    const task = await this.#database
      .prepare('SELECT parentId FROM task WHERE id = ? AND userId = ?')
      .bind(rootTaskId, caretakerId)
      .first<{ parentId: string | null }>()
    if (!task) throw new RecipientServiceError('not_found', 'Task tree does not exist')
    if (task.parentId !== null) {
      throw new RecipientServiceError('invalid', 'Only a root task can be assigned')
    }

    // Re-assigning an existing pair changes nothing, so it stays a no-op even at
    // the limit; only a new assignment has to fit within it.
    const existing = await this.#database
      .prepare('SELECT 1 AS present FROM task_assignment WHERE recipientId = ? AND rootTaskId = ?')
      .bind(recipientId, rootTaskId)
      .first<{ present: number }>()
    if (existing) return

    const assigned = await this.#database
      .prepare('SELECT COUNT(*) AS total FROM task_assignment WHERE recipientId = ?')
      .bind(recipientId)
      .first<{ total: number }>()
    if ((assigned?.total ?? 0) >= RECIPIENT_LIMITS.maxAssignmentsPerRecipient) {
      throw new RecipientServiceError(
        'conflict',
        `A recipient cannot have more than ${RECIPIENT_LIMITS.maxAssignmentsPerRecipient} assigned task trees`,
      )
    }

    await this.#database
      .prepare(
        `INSERT INTO task_assignment (recipientId, rootTaskId, caretakerId)
           VALUES (?, ?, ?)
           ON CONFLICT (recipientId, rootTaskId) DO NOTHING`,
      )
      .bind(recipientId, rootTaskId, caretakerId)
      .run()
  }

  async unassignTaskTree(
    caretakerId: string,
    recipientId: string,
    rootTaskId: string,
  ): Promise<void> {
    await this.#ownedRecipient(caretakerId, recipientId)
    await this.#database
      .prepare(
        'DELETE FROM task_assignment WHERE recipientId = ? AND rootTaskId = ? AND caretakerId = ?',
      )
      .bind(recipientId, rootTaskId, caretakerId)
      .run()
  }

  /**
   * Authoritative check behind every recipient request: the recipient exists,
   * is enabled, and the presented session is the one enrollment activated.
   */
  async findActiveRecipient(userId: string, sessionId: string): Promise<ActiveRecipient | null> {
    const recipient = await this.#database
      .prepare(
        `SELECT id, userId, displayName FROM recipient
           WHERE userId = ? AND activeSessionId = ? AND isActive = 1`,
      )
      .bind(userId, sessionId)
      .first<ActiveRecipient>()
    return recipient
  }

  /** Complete assigned task trees, without any caretaker-only metadata. */
  async getAssignedTaskTrees(recipientId: string): Promise<TaskNode[]> {
    const { results } = await this.#database
      .prepare(
        `WITH RECURSIVE assigned(id) AS (
            SELECT rootTaskId FROM task_assignment WHERE recipientId = ?
            UNION
            SELECT task.id FROM task JOIN assigned ON task.parentId = assigned.id
          )
          SELECT ${TASK_TREE_COLUMNS} FROM task WHERE id IN (SELECT id FROM assigned)`,
      )
      .bind(recipientId)
      .all<TaskRow>()

    return buildTaskTrees(results).map(
      ({ categoryId: _categoryId, revision: _revision, ...node }) => node,
    )
  }
}
