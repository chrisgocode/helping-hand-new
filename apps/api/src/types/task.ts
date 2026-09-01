import type { Logger } from 'pino'
import type { AuthBindings } from '../auth'
import type { RateLimitBindings } from '../middleware/rate-limit'
import type { TaskAiBindings, TaskAiFailureKind } from '../services/task-ai'

export type TaskRouteEnv = {
  Bindings: AuthBindings & TaskAiBindings & RateLimitBindings & { APP_ENV?: string }
  Variables: {
    logger: Logger
    requestId: string
    userId: string | undefined
    authenticatedUserId: string
    aiRequestObserved: boolean | undefined
    aiFailureKind: TaskAiFailureKind | undefined
    aiProviderStatus: number | undefined
  }
}
