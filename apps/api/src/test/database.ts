import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

/**
 * Splits a migration the way Wrangler does. A trigger body carries its own
 * semicolons, so it stays one statement until its closing `END`.
 */
function splitStatements(migration: string) {
  const statements: string[] = []
  let buffer = ''

  for (const fragment of migration.split(';')) {
    buffer += fragment
    const statement = buffer.trim()
    if (/create\s+trigger/i.test(statement) && !/\bend$/i.test(statement)) {
      buffer += ';'
      continue
    }
    if (statement) statements.push(statement)
    buffer = ''
  }

  return statements
}

export async function createTestDatabase() {
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response() } }',
      d1Databases: { database: ':memory:' },
    }),
  )
  const database = (await miniflare.getD1Database('database')) as D1Database
  const migrationsDirectory = new URL('../migrations/', import.meta.url)
  const migrationFiles = []

  for await (const file of new Bun.Glob('*.sql').scan(migrationsDirectory.pathname)) {
    migrationFiles.push(file)
  }

  for (const file of migrationFiles.sort()) {
    const migration = await Bun.file(new URL(file, migrationsDirectory)).text()
    await database.batch(splitStatements(migration).map((statement) => database.prepare(statement)))
  }

  return { database, miniflare }
}

export async function createTestUser(
  database: D1Database,
  id: string,
  email = `${id}@example.com`,
) {
  await database
    .prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, 'Test User', email, 1, '2026-01-01', '2026-01-01')
    .run()
}
