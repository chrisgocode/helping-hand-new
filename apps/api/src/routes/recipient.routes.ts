import '@hono/zod-openapi'
import {
  problemDetailsSchema,
  recipientAssignmentSchema,
  recipientIdentitySchema,
  recipientSchema,
} from '@helping-hand/schemas'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  assignRecipientTask,
  createRecipient,
  getAssignedTaskTrees,
  getRecipientIdentity,
  getRecipients,
  getRecipientTasks,
  handleRecipientError,
  revokeRecipientAccess,
  unassignRecipientTask,
  updateRecipient,
} from '../controllers/recipient.controller'
import {
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
import type { ApiEnv } from '../types/api'

/** Caretaker-facing recipient management, mounted at `/api/recipients`. */
export const recipientRoutes = new OpenAPIHono<ApiEnv>()

recipientRoutes.openAPIRegistry.register('Recipient', recipientSchema)
recipientRoutes.openAPIRegistry.register('RecipientAssignment', recipientAssignmentSchema)
recipientRoutes.openAPIRegistry.register('ProblemDetails', problemDetailsSchema)

recipientRoutes.openapi(createRecipientRoute, createRecipient)
recipientRoutes.openapi(getRecipientsRoute, getRecipients)
recipientRoutes.openapi(updateRecipientRoute, updateRecipient)
recipientRoutes.openapi(getRecipientTasksRoute, getRecipientTasks)
recipientRoutes.openapi(assignRecipientTaskRoute, assignRecipientTask)
recipientRoutes.openapi(unassignRecipientTaskRoute, unassignRecipientTask)
recipientRoutes.openapi(revokeRecipientAccessRoute, revokeRecipientAccess)
recipientRoutes.onError(handleRecipientError)

/** Recipient-device reads, mounted at `/api/recipient`. */
export const recipientAccessRoutes = new OpenAPIHono<ApiEnv>()

recipientAccessRoutes.openAPIRegistry.register('RecipientIdentity', recipientIdentitySchema)

recipientAccessRoutes.openapi(getRecipientIdentityRoute, getRecipientIdentity)
recipientAccessRoutes.openapi(getAssignedTaskTreesRoute, getAssignedTaskTrees)
recipientAccessRoutes.onError(handleRecipientError)
