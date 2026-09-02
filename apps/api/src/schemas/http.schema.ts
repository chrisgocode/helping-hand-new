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
