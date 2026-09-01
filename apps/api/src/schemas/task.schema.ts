import {
  breakdownProposalInputSchema,
  deleteTaskInputSchema,
  orderOptimizationProposalSchema,
  problemDetailsSchema,
  taskBreakdownProposalSchema,
  taskDurationProposalSchema,
  taskProposalInputSchema,
  taskTreeDraftSchema,
  taskTreeListSchema,
  taskTreeSchema,
} from '@helping-hand/schemas'
import { createRoute, z } from '@hono/zod-openapi'
import { logAiRequest } from '../middleware/observability'
import { rateLimit } from '../middleware/rate-limit'
import { requireAuth } from '../middleware/require-auth'

const problemResponse = (description: string) => ({
  description,
  content: {
    'application/problem+json': { schema: problemDetailsSchema },
  },
})

const rootIdParamsSchema = z.object({
  rootId: z.uuid().openapi({ param: { name: 'rootId', in: 'path' } }),
})

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

export const getTaskTreesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getTaskTrees',
  tags: ['Tasks'],
  summary: 'Get every saved task tree',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  responses: {
    200: {
      description: 'Saved task trees ordered newest first',
      content: { 'application/json': { schema: taskTreeListSchema } },
    },
    401: problemResponse('Authentication is required'),
    429: problemResponse('The request rate limit was exceeded'),
    500: problemResponse('The request could not be completed'),
  },
})

export const saveTaskTreeRoute = createRoute({
  method: 'put',
  path: '/{rootId}',
  operationId: 'saveTaskTree',
  tags: ['Tasks'],
  summary: 'Create or replace a complete task tree',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: {
    params: rootIdParamsSchema,
    body: jsonBody(taskTreeDraftSchema),
  },
  responses: {
    200: {
      description: 'The saved task tree',
      content: { 'application/json': { schema: taskTreeSchema } },
    },
    400: problemResponse('The task tree is invalid'),
    401: problemResponse('Authentication is required'),
    404: problemResponse('The task tree does not exist'),
    409: problemResponse('The task tree revision conflicts with the saved revision'),
    429: problemResponse('The request rate limit was exceeded'),
    500: problemResponse('The request could not be completed'),
  },
})

export const deleteTaskTreeRoute = createRoute({
  method: 'delete',
  path: '/{rootId}',
  operationId: 'deleteTaskTree',
  tags: ['Tasks'],
  summary: 'Delete a complete task tree',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: {
    params: rootIdParamsSchema,
    body: jsonBody(deleteTaskInputSchema),
  },
  responses: {
    204: { description: 'The task tree was deleted' },
    400: problemResponse('The request is invalid'),
    401: problemResponse('Authentication is required'),
    404: problemResponse('The task tree does not exist'),
    409: problemResponse('The task tree revision conflicts with the saved revision'),
    429: problemResponse('The request rate limit was exceeded'),
    500: problemResponse('The request could not be completed'),
  },
})

const proposalResponses = {
  400: problemResponse('The task-tree draft is invalid'),
  401: problemResponse('Authentication is required for this saved task tree'),
  404: problemResponse('The selected task or saved task tree does not exist'),
  409: problemResponse('The saved task tree revision has changed'),
  429: problemResponse('The AI request rate limit was exceeded'),
  500: problemResponse('AI generation is not configured correctly'),
  502: problemResponse('AI generation returned an invalid response'),
  503: problemResponse('AI generation is temporarily unavailable'),
  504: problemResponse('AI generation timed out'),
}

export const proposeTaskBreakdownRoute = createRoute({
  method: 'post',
  path: '/proposals/breakdown',
  operationId: 'proposeTaskBreakdown',
  tags: ['Tasks'],
  summary: 'Propose immediate children for an actionable task',
  description:
    'The proposal does not modify the draft. A saved draft requires an authenticated owner.',
  middleware: [rateLimit('ai'), logAiRequest('breakdown')] as const,
  request: { body: jsonBody(breakdownProposalInputSchema) },
  responses: {
    200: {
      description: 'A one-level task breakdown proposal',
      content: { 'application/json': { schema: taskBreakdownProposalSchema } },
    },
    ...proposalResponses,
  },
})

export const proposeTaskDurationsRoute = createRoute({
  method: 'post',
  path: '/proposals/durations',
  operationId: 'proposeTaskDurations',
  tags: ['Tasks'],
  summary: 'Propose missing durations for a task subtree',
  description:
    'The proposal does not modify the draft. A saved draft requires an authenticated owner.',
  middleware: [rateLimit('ai'), logAiRequest('durations')] as const,
  request: { body: jsonBody(taskProposalInputSchema) },
  responses: {
    200: {
      description: 'Duration proposals for actionable tasks missing a duration',
      content: { 'application/json': { schema: taskDurationProposalSchema } },
    },
    ...proposalResponses,
  },
})

export const proposeTaskOrderRoute = createRoute({
  method: 'post',
  path: '/proposals/order',
  operationId: 'proposeTaskOrder',
  tags: ['Tasks'],
  summary: 'Propose a dependency-aware order for immediate children',
  description:
    'The proposal does not modify the draft or move tasks to another parent. A saved draft requires an authenticated owner.',
  middleware: [rateLimit('ai'), logAiRequest('order')] as const,
  request: { body: jsonBody(taskProposalInputSchema) },
  responses: {
    200: {
      description: 'A proposed sibling order',
      content: { 'application/json': { schema: orderOptimizationProposalSchema } },
    },
    ...proposalResponses,
  },
})
