import type { RouteHandler } from '@hono/zod-openapi'
import type { Context, ErrorHandler } from 'hono'
import { problem } from '../lib/problem'
import type {
  createCategoryRoute,
  deleteCategoryRoute,
  getCategoriesRoute,
  renameCategoryRoute,
  reorderCategoriesRoute,
} from '../schemas/category.schema'
import { CategoryService, CategoryServiceError } from '../services/category.service'
import type { ApiEnv } from '../types/api'

function categoryService(c: Context<ApiEnv>) {
  return new CategoryService({ database: c.env.database })
}

export const getCategories: RouteHandler<typeof getCategoriesRoute, ApiEnv> = async (c) =>
  c.json(await categoryService(c).getCategories(c.get('authenticatedUserId')), 200)

export const createCategory: RouteHandler<typeof createCategoryRoute, ApiEnv> = async (c) =>
  c.json(
    await categoryService(c).createCategory(c.get('authenticatedUserId'), c.req.valid('json')),
    201,
  )

export const renameCategory: RouteHandler<typeof renameCategoryRoute, ApiEnv> = async (c) =>
  c.json(
    await categoryService(c).renameCategory(
      c.get('authenticatedUserId'),
      c.req.valid('param').categoryId,
      c.req.valid('json'),
    ),
    200,
  )

export const reorderCategories: RouteHandler<typeof reorderCategoriesRoute, ApiEnv> = async (c) =>
  c.json(
    await categoryService(c).reorderCategories(c.get('authenticatedUserId'), c.req.valid('json')),
    200,
  )

export const deleteCategory: RouteHandler<typeof deleteCategoryRoute, ApiEnv> = async (c) => {
  await categoryService(c).deleteCategory(
    c.get('authenticatedUserId'),
    c.req.valid('param').categoryId,
  )
  return c.body(null, 204)
}

export const handleCategoryError: ErrorHandler<ApiEnv> = (error, c) => {
  if (!(error instanceof CategoryServiceError)) {
    c.get('logger').error({
      event: 'unhandled_error',
      code: 'internal_error',
      route: c.req.routePath,
    })
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:internal-error',
        title: 'Internal server error',
        detail: 'The request could not be completed.',
        retryable: false,
      },
      500,
    )
  }

  if (error.code === 'not_found') {
    return problem(
      c,
      {
        type: 'urn:helping-hand:problem:not-found',
        title: 'Category not found',
        detail: error.message,
        retryable: false,
      },
      404,
    )
  }
  return problem(
    c,
    {
      type: 'urn:helping-hand:problem:conflict',
      title: 'Category conflict',
      detail: error.message,
      retryable: false,
    },
    409,
  )
}
