import {
  categoryListSchema,
  categorySchema,
  createCategoryInputSchema,
  renameCategoryInputSchema,
  reorderCategoriesInputSchema,
} from '@helping-hand/schemas'
import { createRoute, z } from '@hono/zod-openapi'
import { requireAuth } from '../middleware/require-auth'
import { jsonBody, problemResponse } from './http.schema'

const categoryIdParamsSchema = z.object({
  categoryId: z.uuid().openapi({ param: { name: 'categoryId', in: 'path' } }),
})

const categoryErrors = {
  401: problemResponse('Authentication is required'),
  429: problemResponse('The request rate limit was exceeded'),
  500: problemResponse('The request could not be completed'),
}

export const getCategoriesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getCategories',
  tags: ['Categories'],
  summary: 'Get the category list',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  responses: {
    200: {
      description: 'Categories in persistent position order',
      content: { 'application/json': { schema: categoryListSchema } },
    },
    ...categoryErrors,
  },
})

export const createCategoryRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'createCategory',
  tags: ['Categories'],
  summary: 'Create a category at the end of the list',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: { body: jsonBody(createCategoryInputSchema) },
  responses: {
    201: {
      description: 'The created category',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: problemResponse('The category is invalid'),
    409: problemResponse('The category conflicts with current category data'),
    ...categoryErrors,
  },
})

export const reorderCategoriesRoute = createRoute({
  method: 'put',
  path: '/order',
  operationId: 'reorderCategories',
  tags: ['Categories'],
  summary: 'Replace the complete category order',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: { body: jsonBody(reorderCategoriesInputSchema) },
  responses: {
    200: {
      description: 'The reordered category list',
      content: { 'application/json': { schema: categoryListSchema } },
    },
    400: problemResponse('The category order is invalid'),
    409: problemResponse('The category list has changed'),
    ...categoryErrors,
  },
})

export const renameCategoryRoute = createRoute({
  method: 'patch',
  path: '/{categoryId}',
  operationId: 'renameCategory',
  tags: ['Categories'],
  summary: 'Rename a category',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: {
    params: categoryIdParamsSchema,
    body: jsonBody(renameCategoryInputSchema),
  },
  responses: {
    200: {
      description: 'The renamed category',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: problemResponse('The category is invalid'),
    404: problemResponse('The category does not exist'),
    409: problemResponse('The category name conflicts with another category'),
    ...categoryErrors,
  },
})

export const deleteCategoryRoute = createRoute({
  method: 'delete',
  path: '/{categoryId}',
  operationId: 'deleteCategory',
  tags: ['Categories'],
  summary: 'Delete a category and uncategorize its root tasks',
  security: [{ cookieAuth: [] }],
  middleware: [requireAuth] as const,
  request: { params: categoryIdParamsSchema },
  responses: {
    204: { description: 'The category was deleted' },
    404: problemResponse('The category does not exist'),
    ...categoryErrors,
  },
})
