import { problemDetailsSchema } from '@helping-hand/schemas'
import type { z } from '@hono/zod-openapi'

export const problemResponse = (description: string) => ({
  description,
  content: {
    'application/problem+json': { schema: problemDetailsSchema },
  },
})

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

/**
 * Caretakers authenticate with the session cookie. Declared as one shared value
 * so route inference sees a single security type.
 */
export const caretakerSecurity: Record<string, string[]>[] = [{ cookieAuth: [] }]

/** Enrolled recipient devices only ever use a bearer token. */
export const recipientSecurity: Record<string, string[]>[] = [{ bearerAuth: [] }]

/**
 * Every caretaker route fails these four ways. Only the rate-limit description
 * varies, because each group of routes documents its own limit.
 */
export const caretakerErrors = (rateLimitDescription = 'The request rate limit was exceeded') => ({
  401: problemResponse('Authentication is required'),
  403: problemResponse('A recipient device cannot perform this operation'),
  429: problemResponse(rateLimitDescription),
  500: problemResponse('The request could not be completed'),
})
