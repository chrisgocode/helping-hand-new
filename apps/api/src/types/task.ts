import type { TaskTreeDraft } from '@helping-hand/schemas'
import type { Logger } from 'pino'
import type { AuthBindings } from '../auth'
import type { RateLimitBindings } from '../middleware/rate-limit'
import type { TaskAiBindings, TaskAiFailureKind } from '../services/task-ai'

export type TaskDetail = 1 | 2 | 3 | 4 | 5
export type DeleteTaskInput = { revision: number }
export type TaskProposalInput = { draft: TaskTreeDraft; taskId: string }
export type BreakdownProposalInput = TaskProposalInput & { detail: TaskDetail }

export type TaskRouteEnv = {
  Bindings: AuthBindings & TaskAiBindings & RateLimitBindings
  Variables: {
    logger: Logger
    requestId: string
    userId: string | undefined
    authenticatedUserId: string
    rootId: string
    saveTaskInput: TaskTreeDraft
    deleteTaskInput: DeleteTaskInput
    taskProposalInput: TaskProposalInput
    breakdownProposalInput: BreakdownProposalInput
    aiFailureKind: TaskAiFailureKind | undefined
    aiProviderStatus: number | undefined
  }
}
