import '@hono/zod-openapi'
import { categoryListSchema, categorySchema, problemDetailsSchema } from '@helping-hand/schemas'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  createCategory,
  deleteCategory,
  getCategories,
  handleCategoryError,
  renameCategory,
  reorderCategories,
} from '../controllers/category.controller'
import {
  createCategoryRoute,
  deleteCategoryRoute,
  getCategoriesRoute,
  renameCategoryRoute,
  reorderCategoriesRoute,
} from '../schemas/category.schema'
import type { ApiEnv } from '../types/api'

export const categoryRoutes = new OpenAPIHono<ApiEnv>()

categoryRoutes.openAPIRegistry.register('Category', categorySchema)
categoryRoutes.openAPIRegistry.register('CategoryList', categoryListSchema)
categoryRoutes.openAPIRegistry.register('ProblemDetails', problemDetailsSchema)

categoryRoutes.openapi(getCategoriesRoute, getCategories)
categoryRoutes.openapi(createCategoryRoute, createCategory)
categoryRoutes.openapi(reorderCategoriesRoute, reorderCategories)
categoryRoutes.openapi(renameCategoryRoute, renameCategory)
categoryRoutes.openapi(deleteCategoryRoute, deleteCategory)
categoryRoutes.onError(handleCategoryError)
