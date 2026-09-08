import { z } from 'zod'
import { taskNodeSchema } from './task'

export const RECIPIENT_LIMITS = {
  maxRecipientsPerCaretaker: 25,
  maxAssignmentsPerRecipient: 50,
} as const

export const recipientDisplayNameSchema = z.string().trim().min(1).max(100)

export const recipientSchema = z.strictObject({
  id: z.uuid(),
  displayName: recipientDisplayNameSchema,
  isActive: z.boolean(),
  hasActiveSession: z.boolean(),
  pendingEnrollmentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const recipientListSchema = z.array(recipientSchema)

export const createRecipientInputSchema = z.strictObject({
  displayName: recipientDisplayNameSchema,
})

export const updateRecipientInputSchema = z
  .strictObject({
    displayName: recipientDisplayNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (input) => input.displayName !== undefined || input.isActive !== undefined,
    'Provide a display name or an active state',
  )

export const recipientAssignmentSchema = z.strictObject({
  rootTaskId: z.uuid(),
  createdAt: z.iso.datetime(),
})

export const recipientAssignmentListSchema = z.array(recipientAssignmentSchema)

export const recipientIdentitySchema = z.strictObject({
  recipientId: z.uuid(),
  displayName: recipientDisplayNameSchema,
  sessionExpiresAt: z.iso.datetime(),
})

/**
 * Assigned task trees carry no caretaker metadata: no category, no revision,
 * and no owner.
 */
export const recipientTaskTreeListSchema = z.array(taskNodeSchema)

export type Recipient = z.infer<typeof recipientSchema>
export type CreateRecipientInput = z.infer<typeof createRecipientInputSchema>
export type UpdateRecipientInput = z.infer<typeof updateRecipientInputSchema>
export type RecipientAssignment = z.infer<typeof recipientAssignmentSchema>
export type RecipientIdentity = z.infer<typeof recipientIdentitySchema>
