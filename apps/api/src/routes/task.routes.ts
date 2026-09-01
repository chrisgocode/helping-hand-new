import '@hono/zod-openapi'
import {
  orderOptimizationProposalSchema,
  problemDetailsSchema,
  taskBreakdownProposalSchema,
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
} from '../controllers/task.controller'
import {
  deleteTaskTreeRoute,
  getTaskTreesRoute,
  proposeTaskBreakdownRoute,
  proposeTaskDurationsRoute,
  proposeTaskOrderRoute,
  saveTaskTreeRoute,
} from '../schemas/task.schema'
import type { TaskRouteEnv } from '../types/task'

export const taskRoutes = new OpenAPIHono<TaskRouteEnv>()

taskRoutes.openAPIRegistry.register('TaskNode', taskNodeSchema)
taskRoutes.openAPIRegistry.register('TaskTreeDraft', taskTreeDraftSchema)
taskRoutes.openAPIRegistry.register('TaskTree', taskTreeSchema)
taskRoutes.openAPIRegistry.register('TaskBreakdownProposal', taskBreakdownProposalSchema)
taskRoutes.openAPIRegistry.register('TaskDurationProposal', taskDurationProposalSchema)
taskRoutes.openAPIRegistry.register('OrderOptimizationProposal', orderOptimizationProposalSchema)
taskRoutes.openAPIRegistry.register('ProblemDetails', problemDetailsSchema)
taskRoutes.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'better-auth.session_token',
  description: 'Better Auth session cookie. Secure deployments may add a secure cookie prefix.',
})

taskRoutes.openapi(getTaskTreesRoute, getTaskTrees)
taskRoutes.openapi(saveTaskTreeRoute, saveTaskTree)
taskRoutes.openapi(deleteTaskTreeRoute, deleteTaskTree)
taskRoutes.openapi(proposeTaskBreakdownRoute, proposeBreakdown)
taskRoutes.openapi(proposeTaskDurationsRoute, proposeDurations)
taskRoutes.openapi(proposeTaskOrderRoute, proposeOrder)
taskRoutes.onError(handleTaskError)
