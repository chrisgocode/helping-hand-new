import {
  createRecipientInputSchema,
  recipientAssignmentListSchema,
  recipientIdentitySchema,
  recipientListSchema,
  recipientSchema,
  recipientTaskTreeListSchema,
  updateRecipientInputSchema,
} from '@helping-hand/schemas'
import { createRoute, z } from '@hono/zod-openapi'
import { requireCaretaker, requireRecipient } from '../middleware/require-auth'
import {
  caretakerErrors,
  caretakerSecurity,
  jsonBody,
  problemResponse,
  recipientSecurity,
} from './http.schema'

/** Shared path parameter: recipient routes and enrollment issuing both use it. */
export const recipientIdParamsSchema = z.object({
  recipientId: z.uuid().openapi({ param: { name: 'recipientId', in: 'path' } }),
})

const recipientTaskParamsSchema = recipientIdParamsSchema.extend({
  taskId: z.uuid().openapi({ param: { name: 'taskId', in: 'path' } }),
})

const recipientErrors = {
  401: problemResponse('The device is not enrolled or its access was revoked'),
  403: problemResponse('A caretaker account cannot perform this operation'),
  429: problemResponse('The request rate limit was exceeded'),
  500: problemResponse('The request could not be completed'),
}

export const createRecipientRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createRecipient',
  tags: ['Recipients'],
  summary: 'Create a recipient profile and its credential-free identity',
  description: 'No device is signed in. Use an enrollment to sign a device in.',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: { body: jsonBody(createRecipientInputSchema) },
  responses: {
    201: {
      description: 'The created recipient',
      content: { 'application/json': { schema: recipientSchema } },
    },
    400: problemResponse('The recipient is invalid'),
    409: problemResponse('The recipient limit was reached'),
    ...caretakerErrors(),
  },
})

export const getRecipientsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getRecipients',
  tags: ['Recipients'],
  summary: "Get the caretaker's recipients with enrollment and access status",
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  responses: {
    200: {
      description: 'Recipients ordered oldest first',
      content: { 'application/json': { schema: recipientListSchema } },
    },
    ...caretakerErrors(),
  },
})

export const updateRecipientRoute = createRoute({
  method: 'patch',
  path: '/{recipientId}',
  operationId: 'updateRecipient',
  tags: ['Recipients'],
  summary: 'Update a recipient display name or active state',
  description: 'Disabling a recipient revokes device access and cancels a pending enrollment.',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: {
    params: recipientIdParamsSchema,
    body: jsonBody(updateRecipientInputSchema),
  },
  responses: {
    200: {
      description: 'The updated recipient',
      content: { 'application/json': { schema: recipientSchema } },
    },
    400: problemResponse('The recipient update is invalid'),
    404: problemResponse('The recipient does not exist'),
    ...caretakerErrors(),
  },
})

export const getRecipientTasksRoute = createRoute({
  method: 'get',
  path: '/{recipientId}/tasks',
  operationId: 'getRecipientTasks',
  tags: ['Recipients'],
  summary: 'Get the root tasks assigned to a recipient',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: { params: recipientIdParamsSchema },
  responses: {
    200: {
      description: 'Assigned root tasks',
      content: { 'application/json': { schema: recipientAssignmentListSchema } },
    },
    404: problemResponse('The recipient does not exist'),
    ...caretakerErrors(),
  },
})

export const assignRecipientTaskRoute = createRoute({
  method: 'put',
  path: '/{recipientId}/tasks/{taskId}',
  operationId: 'assignRecipientTask',
  tags: ['Recipients'],
  summary: 'Assign a complete task tree to a recipient',
  description: 'Assignment is idempotent and the task must be a root task.',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: { params: recipientTaskParamsSchema },
  responses: {
    204: { description: 'The task tree is assigned' },
    400: problemResponse('Only a root task can be assigned'),
    404: problemResponse('The recipient or task tree does not exist'),
    409: problemResponse('The assignment limit was reached'),
    ...caretakerErrors(),
  },
})

export const unassignRecipientTaskRoute = createRoute({
  method: 'delete',
  path: '/{recipientId}/tasks/{taskId}',
  operationId: 'unassignRecipientTask',
  tags: ['Recipients'],
  summary: 'Remove a task tree assignment from a recipient',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: { params: recipientTaskParamsSchema },
  responses: {
    204: { description: 'The task tree is not assigned' },
    404: problemResponse('The recipient does not exist'),
    ...caretakerErrors(),
  },
})

export const revokeRecipientAccessRoute = createRoute({
  method: 'delete',
  path: '/{recipientId}/session',
  operationId: 'revokeRecipientAccess',
  tags: ['Recipients'],
  summary: 'Revoke recipient device access',
  description:
    'Cancels a pending enrollment and ends the current device session. The recipient profile and its assignments are preserved.',
  security: caretakerSecurity,
  middleware: [requireCaretaker] as const,
  request: { params: recipientIdParamsSchema },
  responses: {
    204: { description: 'Device access was revoked' },
    404: problemResponse('The recipient does not exist'),
    ...caretakerErrors(),
  },
})

export const getRecipientIdentityRoute = createRoute({
  method: 'get',
  path: '/me',
  operationId: 'getRecipientIdentity',
  tags: ['Recipient access'],
  summary: 'Get the enrolled recipient identity and session expiry',
  security: recipientSecurity,
  middleware: [requireRecipient] as const,
  responses: {
    200: {
      description: 'The enrolled recipient',
      content: { 'application/json': { schema: recipientIdentitySchema } },
    },
    ...recipientErrors,
  },
})

export const getAssignedTaskTreesRoute = createRoute({
  method: 'get',
  path: '/tasks',
  operationId: 'getAssignedTaskTrees',
  tags: ['Recipient access'],
  summary: 'Get the complete task trees assigned to this device',
  description: 'Returns an empty list when nothing is assigned.',
  security: recipientSecurity,
  middleware: [requireRecipient] as const,
  responses: {
    200: {
      description: 'Assigned task trees',
      content: { 'application/json': { schema: recipientTaskTreeListSchema } },
    },
    ...recipientErrors,
  },
})
