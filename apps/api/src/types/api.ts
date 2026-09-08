import type { Logger } from 'pino'
import type { AccountKind, AuthBindings } from '../auth'
import type { RateLimitBindings } from '../middleware/rate-limit'
import type { ActiveRecipient } from '../services/recipient.service'
import type { TaskAiBindings, TaskAiFailureKind } from '../services/task-ai'

export type ApiEnv = {
  Bindings: AuthBindings & TaskAiBindings & RateLimitBindings & { APP_ENV?: string }
  Variables: {
    logger: Logger
    requestId: string
    userId: string | undefined
    accountKind: AccountKind | undefined
    sessionId: string | undefined
    sessionExpiresAt: string | undefined
    authenticatedUserId: string
    recipient: ActiveRecipient
    recipientSessionExpiresAt: string
    aiRequestObserved: boolean | undefined
    aiFailureKind: TaskAiFailureKind | undefined
    aiProviderStatus: number | undefined
  }
}
