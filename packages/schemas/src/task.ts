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
export type TaskTree = Omit<TaskTreeDraft, 'revision'> & { revision: number }

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
