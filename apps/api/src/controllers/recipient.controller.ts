import type { RouteHandler } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { audit } from '../lib/audit'
import { serviceErrorHandler } from '../lib/service-error'
import type {
  assignRecipientTaskRoute,
  createRecipientRoute,
  getAssignedTaskTreesRoute,
  getRecipientIdentityRoute,
  getRecipientsRoute,
  getRecipientTasksRoute,
  revokeRecipientAccessRoute,
  unassignRecipientTaskRoute,
  updateRecipientRoute,
} from '../schemas/recipient.schema'
import { RecipientService, RecipientServiceError } from '../services/recipient.service'
import { serviceOptions } from '../services/service-options'
import type { ApiEnv } from '../types/api'

function recipientService(c: Context<ApiEnv>) {
  return new RecipientService(serviceOptions(c))
}

export const createRecipient: RouteHandler<typeof createRecipientRoute, ApiEnv> = async (c) =>
  c.json(
    await recipientService(c).createRecipient(c.get('authenticatedUserId'), c.req.valid('json')),
    201,
  )

export const getRecipients: RouteHandler<typeof getRecipientsRoute, ApiEnv> = async (c) =>
  c.json(await recipientService(c).listRecipients(c.get('authenticatedUserId')), 200)

export const updateRecipient: RouteHandler<typeof updateRecipientRoute, ApiEnv> = async (c) => {
  const { recipientId } = c.req.valid('param')
  const input = c.req.valid('json')
  const recipient = await recipientService(c).updateRecipient(
    c.get('authenticatedUserId'),
    recipientId,
    input,
  )
  // Disabling ends every form of access, so it is audited like an explicit revocation.
  if (input.isActive === false) audit(c, 'recipient_disabled', { recipientId })
  return c.json(recipient, 200)
}

export const getRecipientTasks: RouteHandler<typeof getRecipientTasksRoute, ApiEnv> = async (c) =>
  c.json(
    await recipientService(c).listAssignments(
      c.get('authenticatedUserId'),
      c.req.valid('param').recipientId,
    ),
    200,
  )

export const assignRecipientTask: RouteHandler<typeof assignRecipientTaskRoute, ApiEnv> = async (
  c,
) => {
  const { recipientId, taskId } = c.req.valid('param')
  await recipientService(c).assignTaskTree(c.get('authenticatedUserId'), recipientId, taskId)
  return c.body(null, 204)
}

export const unassignRecipientTask: RouteHandler<
  typeof unassignRecipientTaskRoute,
  ApiEnv
> = async (c) => {
  const { recipientId, taskId } = c.req.valid('param')
  await recipientService(c).unassignTaskTree(c.get('authenticatedUserId'), recipientId, taskId)
  return c.body(null, 204)
}

export const revokeRecipientAccess: RouteHandler<
  typeof revokeRecipientAccessRoute,
  ApiEnv
> = async (c) => {
  const { recipientId } = c.req.valid('param')
  await recipientService(c).revokeRecipientAccess(c.get('authenticatedUserId'), recipientId)
  audit(c, 'recipient_access_revoked', { recipientId })
  return c.body(null, 204)
}

export const getRecipientIdentity: RouteHandler<typeof getRecipientIdentityRoute, ApiEnv> = (c) => {
  const recipient = c.get('recipient')
  return c.json(
    {
      recipientId: recipient.id,
      displayName: recipient.displayName,
      sessionExpiresAt: c.get('recipientSessionExpiresAt'),
    },
    200,
  )
}

export const getAssignedTaskTrees: RouteHandler<typeof getAssignedTaskTreesRoute, ApiEnv> = async (
  c,
) => c.json(await recipientService(c).getAssignedTaskTrees(c.get('recipient').id), 200)

export const handleRecipientError = serviceErrorHandler(RecipientServiceError, {
  invalid: {
    type: 'urn:helping-hand:problem:validation',
    title: 'Invalid request',
    status: 400,
  },
  not_found: {
    type: 'urn:helping-hand:problem:not-found',
    title: 'Recipient not found',
    status: 404,
  },
  conflict: {
    type: 'urn:helping-hand:problem:conflict',
    title: 'Recipient conflict',
    status: 409,
  },
})
