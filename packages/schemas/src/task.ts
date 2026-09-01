import { z } from 'zod'

export const TASK_TREE_LIMITS = {
  maxDepth: 5,
  maxTasksPerRoot: 100,
  maxTasksPerUser: 500,
} as const

export type TaskNode = {
  id: string
  title: string
  durationSeconds: number | null
  children: TaskNode[]
}

const nodeFields = {
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  durationSeconds: z.number().int().nonnegative().nullable(),
}

export const taskNodeSchema: z.ZodType<TaskNode> = z.lazy(() =>
  z.strictObject({
    ...nodeFields,
    children: z.array(taskNodeSchema),
  }),
)

export const taskTreeDraftSchema = z.strictObject({
  ...nodeFields,
  children: z.array(taskNodeSchema),
  revision: z.number().int().nonnegative().nullable(),
})

export type TaskTreeDraft = z.infer<typeof taskTreeDraftSchema>
export const taskTreeSchema = taskTreeDraftSchema.extend({
  revision: z.number().int().nonnegative(),
})
export const taskTreeListSchema = z.array(taskTreeSchema)
export type TaskTree = z.infer<typeof taskTreeSchema>

export const taskDetailSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])
export const deleteTaskInputSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
})
export const taskProposalInputSchema = z.strictObject({
  draft: taskTreeDraftSchema,
  taskId: z.uuid(),
})
export const breakdownProposalInputSchema = taskProposalInputSchema.extend({
  detail: taskDetailSchema,
})

export type TaskDetail = z.infer<typeof taskDetailSchema>
export type DeleteTaskInput = z.infer<typeof deleteTaskInputSchema>
export type TaskProposalInput = z.infer<typeof taskProposalInputSchema>
export type BreakdownProposalInput = z.infer<typeof breakdownProposalInputSchema>

export const taskBreakdownProposalSchema = z.strictObject({
  taskId: z.uuid(),
  children: z
    .array(z.strictObject({ id: z.uuid(), title: z.string().trim().min(1).max(200) }))
    .min(1),
})

export const taskDurationProposalSchema = z.strictObject({
  taskId: z.uuid(),
  durations: z.array(
    z.strictObject({ taskId: z.uuid(), durationSeconds: z.number().int().nonnegative() }),
  ),
})

export const orderOptimizationProposalSchema = z.strictObject({
  taskId: z.uuid(),
  orderedTaskIds: z.array(z.uuid()),
})

export type TaskBreakdownProposal = z.infer<typeof taskBreakdownProposalSchema>
export type TaskDurationProposal = z.infer<typeof taskDurationProposalSchema>
export type OrderOptimizationProposal = z.infer<typeof orderOptimizationProposalSchema>
