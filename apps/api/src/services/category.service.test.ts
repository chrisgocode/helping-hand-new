import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, createTestUser } from '../test/database'
import { CategoryService } from './category.service'

describe('CategoryService', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database
  let categories: CategoryService

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
    await createTestUser(database, 'user-1')
    await createTestUser(database, 'user-2')
    categories = new CategoryService({ database })
  })

  afterEach(async () => miniflare.dispose())

  test('creates API-owned IDs and lists only the users categories in position order', async () => {
    const home = await categories.createCategory('user-1', { name: '  Home  ' })
    const work = await categories.createCategory('user-1', { name: 'Work' })
    await categories.createCategory('user-2', { name: 'Private' })

    expect(home).toMatchObject({ id: expect.any(String), name: 'Home', position: 0 })
    expect(work).toMatchObject({ id: expect.any(String), name: 'Work', position: 1 })
    expect(home.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await categories.getCategories('user-1')).toEqual([home, work])
  })

  test('rejects duplicate names and more than 50 categories', async () => {
    await categories.createCategory('user-1', { name: 'Home' })
    expect(categories.createCategory('user-1', { name: 'home' })).rejects.toMatchObject({
      code: 'conflict',
    })

    for (let index = 1; index < 50; index += 1) {
      await categories.createCategory('user-1', { name: `Category ${index}` })
    }
    expect(categories.createCategory('user-1', { name: 'One too many' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  test('renames an owned category without changing its position', async () => {
    const category = await categories.createCategory('user-1', { name: 'Home' })

    const renamed = await categories.renameCategory('user-1', category.id, { name: 'Household' })

    expect(renamed).toMatchObject({ id: category.id, name: 'Household', position: 0 })
    expect(
      categories.renameCategory('user-2', category.id, { name: 'Private' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('reorders only from the users complete category list', async () => {
    const home = await categories.createCategory('user-1', { name: 'Home' })
    const work = await categories.createCategory('user-1', { name: 'Work' })
    const cooking = await categories.createCategory('user-1', { name: 'Cooking' })
    const privateCategory = await categories.createCategory('user-2', { name: 'Private' })

    expect(
      await categories.reorderCategories('user-1', {
        categoryIds: [cooking.id, home.id, work.id],
      }),
    ).toMatchObject([
      { id: cooking.id, position: 0 },
      { id: home.id, position: 1 },
      { id: work.id, position: 2 },
    ])

    expect(
      categories.reorderCategories('user-1', {
        categoryIds: [cooking.id, home.id, privateCategory.id],
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await categories.getCategories('user-1')).map(({ id }) => id)).toEqual([
      cooking.id,
      home.id,
      work.id,
    ])
  })

  test('deletes an owned category and compacts later positions', async () => {
    await categories.createCategory('user-1', { name: 'Home' })
    const work = await categories.createCategory('user-1', { name: 'Work' })
    const cooking = await categories.createCategory('user-1', { name: 'Cooking' })

    await categories.deleteCategory('user-1', work.id)

    expect(await categories.getCategories('user-1')).toMatchObject([
      { name: 'Home', position: 0 },
      { id: cooking.id, position: 1 },
    ])
    expect(categories.deleteCategory('user-2', cooking.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
