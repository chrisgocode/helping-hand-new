import '@hono/zod-openapi'
import {
  orderOptimizationProposalSchema,
  problemDetailsSchema,
  taskBreakdownProposalSchema,
  taskCategoryAssignmentSchema,
  taskDurationProposalSchema,
  taskNodeSchema,
  taskTreeDraftSchema,
  taskTreeSchema,
} from '@helping-hand/schemas'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  deleteTaskTree,
  getTaskTrees,
  handleTaskError,
  proposeBreakdown,
  proposeDurations,
  proposeOrder,
  saveTaskTree,
  setTaskCategory,
} from '../controllers/task.controller'
import {
  deleteTaskTreeRoute,
  getTaskTreesRoute,
  proposeTaskBreakdownRoute,
  proposeTaskDurationsRoute,
  proposeTaskOrderRoute,
  saveTaskTreeRoute,
  setTaskCategoryRoute,
} from '../schemas/task.schema'
import type { ApiEnv } from '../types/api'

export const taskRoutes = new OpenAPIHono<ApiEnv>()

taskRoutes.openAPIRegistry.register('TaskNode', taskNodeSchema)
taskRoutes.openAPIRegistry.register('TaskTreeDraft', taskTreeDraftSchema)
taskRoutes.openAPIRegistry.register('TaskTree', taskTreeSchema)
taskRoutes.openAPIRegistry.register('TaskBreakdownProposal', taskBreakdownProposalSchema)
taskRoutes.openAPIRegistry.register('TaskDurationProposal', taskDurationProposalSchema)
taskRoutes.openAPIRegistry.register('OrderOptimizationProposal', orderOptimizationProposalSchema)
taskRoutes.openAPIRegistry.register('ProblemDetails', problemDetailsSchema)
taskRoutes.openAPIRegistry.register('TaskCategoryAssignment', taskCategoryAssignmentSchema)
taskRoutes.openapi(getTaskTreesRoute, getTaskTrees)
taskRoutes.openapi(saveTaskTreeRoute, saveTaskTree)
taskRoutes.openapi(deleteTaskTreeRoute, deleteTaskTree)
taskRoutes.openapi(setTaskCategoryRoute, setTaskCategory)
taskRoutes.openapi(proposeTaskBreakdownRoute, proposeBreakdown)
taskRoutes.openapi(proposeTaskDurationsRoute, proposeDurations)
taskRoutes.openapi(proposeTaskOrderRoute, proposeOrder)
taskRoutes.onError(handleTaskError)
