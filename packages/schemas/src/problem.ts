import { z } from 'zod'

export const problemDetailsSchema = z.strictObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  instance: z.string().min(1),
  retryable: z.boolean(),
})

export type ProblemDetails = z.infer<typeof problemDetailsSchema>
