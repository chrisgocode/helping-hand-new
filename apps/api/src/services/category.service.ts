import type {
  Category,
  CreateCategoryInput,
  RenameCategoryInput,
  ReorderCategoriesInput,
} from '@helping-hand/schemas'

type CategoryServiceOptions = { database: D1Database }

function isDuplicateNameError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed: category.userId, category.name')
  )
}

export class CategoryServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message)
  }
}

export class CategoryService {
  readonly #database: D1Database

  constructor({ database }: CategoryServiceOptions) {
    this.#database = database
  }

  async getCategories(userId: string): Promise<Category[]> {
    const { results } = await this.#database
      .prepare(
        'SELECT id, name, position, createdAt, updatedAt FROM category WHERE userId = ? ORDER BY position, id',
      )
      .bind(userId)
      .all<Category>()
    return results
  }

  async createCategory(userId: string, input: CreateCategoryInput): Promise<Category> {
    try {
      const category = await this.#database
        .prepare(
          `INSERT INTO category (id, userId, name, position)
           SELECT ?, ?, ?, COALESCE(MAX(position) + 1, 0)
           FROM category WHERE userId = ?
           HAVING COUNT(*) < 50
           RETURNING id, name, position, createdAt, updatedAt`,
        )
        .bind(crypto.randomUUID(), userId, input.name.trim(), userId)
        .first<Category>()
      if (!category) {
        throw new CategoryServiceError('conflict', 'Users cannot create more than 50 categories')
      }
      return category
    } catch (error) {
      if (error instanceof CategoryServiceError) throw error
      if (isDuplicateNameError(error)) {
        throw new CategoryServiceError('conflict', 'A category with this name already exists')
      }
      throw error
    }
  }

  async renameCategory(
    userId: string,
    categoryId: string,
    input: RenameCategoryInput,
  ): Promise<Category> {
    try {
      const category = await this.#database
        .prepare(
          `UPDATE category
           SET name = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND userId = ?
           RETURNING id, name, position, createdAt, updatedAt`,
        )
        .bind(input.name.trim(), categoryId, userId)
        .first<Category>()
      if (!category) throw new CategoryServiceError('not_found', 'Category does not exist')
      return category
    } catch (error) {
      if (error instanceof CategoryServiceError) throw error
      if (isDuplicateNameError(error)) {
        throw new CategoryServiceError('conflict', 'A category with this name already exists')
      }
      throw error
    }
  }

  async reorderCategories(userId: string, input: ReorderCategoriesInput): Promise<Category[]> {
    const current = await this.getCategories(userId)
    const requestedIds = new Set(input.categoryIds)
    if (
      requestedIds.size !== input.categoryIds.length ||
      current.length !== input.categoryIds.length ||
      current.some(({ id }) => !requestedIds.has(id))
    ) {
      throw new CategoryServiceError('conflict', 'Category list has changed since it was loaded')
    }

    const positions = new Map(current.map(({ id, position }) => [id, position]))
    const updates = input.categoryIds.flatMap((id, position) =>
      positions.get(id) === position
        ? []
        : [
            this.#database
              .prepare(
                `UPDATE category
                 SET position = ?, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ? AND userId = ?`,
              )
              .bind(position, id, userId),
          ],
    )
    if (updates.length > 0) await this.#database.batch(updates)
    return this.getCategories(userId)
  }

  async deleteCategory(userId: string, categoryId: string): Promise<void> {
    const category = await this.#database
      .prepare('SELECT position FROM category WHERE id = ? AND userId = ?')
      .bind(categoryId, userId)
      .first<{ position: number }>()
    if (!category) throw new CategoryServiceError('not_found', 'Category does not exist')

    await this.#database.batch([
      this.#database
        .prepare(
          `UPDATE task SET categoryId = NULL, updatedAt = CURRENT_TIMESTAMP
           WHERE userId = ? AND categoryId = ?`,
        )
        .bind(userId, categoryId),
      this.#database
        .prepare(
          `UPDATE category
           SET position = position - 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE userId = ? AND position > ?`,
        )
        .bind(userId, category.position),
      this.#database
        .prepare('DELETE FROM category WHERE id = ? AND userId = ?')
        .bind(categoryId, userId),
    ])
  }
}
