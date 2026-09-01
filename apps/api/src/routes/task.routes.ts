import { Hono } from 'hono'
import {
  deleteTaskTree,
  getTaskTrees,
  handleTaskError,
  proposeBreakdown,
  proposeDurations,
  proposeOrder,
  saveTaskTree,
} from '../controllers/task.controller'
import { logAiRequest } from '../middleware/observability'
import { rateLimit } from '../middleware/rate-limit'
import { requireAuth } from '../middleware/require-auth'
import {
  validateBreakdownProposal,
  validateDeleteTask,
  validateRootId,
  validateSaveTask,
  validateTaskProposal,
} from '../schemas/task.schema'
import type { TaskRouteEnv } from '../types/task'

export const taskRoutes = new Hono<TaskRouteEnv>()

taskRoutes.get('/', requireAuth, getTaskTrees)
taskRoutes.put('/:rootId', requireAuth, validateRootId, validateSaveTask, saveTaskTree)
taskRoutes.delete('/:rootId', requireAuth, validateRootId, validateDeleteTask, deleteTaskTree)
taskRoutes.post(
  '/proposals/breakdown',
  rateLimit('ai'),
  validateBreakdownProposal,
  logAiRequest('breakdown'),
  proposeBreakdown,
)
taskRoutes.post(
  '/proposals/durations',
  rateLimit('ai'),
  validateTaskProposal,
  logAiRequest('durations'),
  proposeDurations,
)
taskRoutes.post(
  '/proposals/order',
  rateLimit('ai'),
  validateTaskProposal,
  logAiRequest('order'),
  proposeOrder,
)
taskRoutes.onError(handleTaskError)
