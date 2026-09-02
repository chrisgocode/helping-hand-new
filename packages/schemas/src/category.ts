import { z } from 'zod'

export const categoryNameSchema = z.string().trim().min(1).max(100)

export const categorySchema = z.strictObject({
  id: z.uuid(),
  name: categoryNameSchema,
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const categoryListSchema = z.array(categorySchema)
export const createCategoryInputSchema = z.strictObject({ name: categoryNameSchema })
export const renameCategoryInputSchema = createCategoryInputSchema
export const reorderCategoriesInputSchema = z.strictObject({
  categoryIds: z
    .array(z.uuid())
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Category IDs must be unique'),
})
export const setTaskCategoryInputSchema = z.strictObject({ categoryId: z.uuid().nullable() })
export const taskCategoryAssignmentSchema = z.strictObject({
  rootId: z.uuid(),
  categoryId: z.uuid().nullable(),
})

export type Category = z.infer<typeof categorySchema>
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>
export type RenameCategoryInput = z.infer<typeof renameCategoryInputSchema>
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInputSchema>
export type SetTaskCategoryInput = z.infer<typeof setTaskCategoryInputSchema>
export type TaskCategoryAssignment = z.infer<typeof taskCategoryAssignmentSchema>
