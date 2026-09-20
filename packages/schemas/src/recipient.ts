import { z } from 'zod'
import { categoryNameSchema } from './category'
import { taskNodeFields, taskNodeSchema } from './task'

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
 * The category a recipient hears a routine grouped under. Only the name a
 * caretaker chose travels; position and timestamps stay caretaker-only.
 */
export const recipientTaskCategorySchema = z.strictObject({
  id: z.uuid(),
  name: categoryNameSchema,
})

/**
 * An assigned task tree as its recipient device sees it. Category travels
 * because a recipient asks for a routine by the group it is in; revision and
 * owner remain caretaker metadata and are still withheld.
 */
export const recipientTaskTreeSchema = z.strictObject({
  ...taskNodeFields,
  children: z.array(taskNodeSchema),
  category: recipientTaskCategorySchema.nullable(),
})

export const recipientTaskTreeListSchema = z.array(recipientTaskTreeSchema)

export type Recipient = z.infer<typeof recipientSchema>
export type CreateRecipientInput = z.infer<typeof createRecipientInputSchema>
export type UpdateRecipientInput = z.infer<typeof updateRecipientInputSchema>
export type RecipientAssignment = z.infer<typeof recipientAssignmentSchema>
export type RecipientIdentity = z.infer<typeof recipientIdentitySchema>
export type RecipientTaskTree = z.infer<typeof recipientTaskTreeSchema>
