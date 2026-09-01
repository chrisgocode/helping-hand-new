import { taskTreeDraftSchema } from '@helping-hand/schemas'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type {
  BreakdownProposalInput,
  DeleteTaskInput,
  TaskProposalInput,
  TaskRouteEnv,
} from '../types/task'

const deleteTaskSchema = z.strictObject({ revision: z.number().int().nonnegative() })
const taskProposalSchema = z.strictObject({ draft: taskTreeDraftSchema, taskId: z.uuid() })
const breakdownProposalSchema = taskProposalSchema.extend({
  detail: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
})

function validateJson<T>(
  schema: z.ZodType<T>,
  set: (context: Context<TaskRouteEnv>, value: T) => void,
) {
  return createMiddleware<TaskRouteEnv>(async (c, next) => {
    const result = schema.safeParse(await c.req.json().catch(() => null))
    if (!result.success) return c.json({ error: 'Invalid request body' }, 400)
    set(c, result.data)
    await next()
  })
}

export const validateRootId = createMiddleware<TaskRouteEnv>(async (c, next) => {
  const result = z.uuid().safeParse(c.req.param('rootId'))
  if (!result.success) return c.json({ error: 'Invalid root task ID' }, 400)
  c.set('rootId', result.data)
  await next()
})

export const validateSaveTask = validateJson(taskTreeDraftSchema, (c, value) =>
  c.set('saveTaskInput', value),
)
export const validateDeleteTask = validateJson(deleteTaskSchema, (c, value: DeleteTaskInput) =>
  c.set('deleteTaskInput', value),
)
export const validateTaskProposal = validateJson(
  taskProposalSchema,
  (c, value: TaskProposalInput) => c.set('taskProposalInput', value),
)
export const validateBreakdownProposal = validateJson(
  breakdownProposalSchema,
  (c, value: BreakdownProposalInput) => c.set('breakdownProposalInput', value),
)
