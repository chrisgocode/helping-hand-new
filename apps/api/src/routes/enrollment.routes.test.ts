import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateSecret } from '../lib/secrets'
import {
  bearer,
  createRecipient,
  enrollDevice,
  json,
  request,
  saveTaskTree,
  signInCaretaker,
  testEnv,
} from '../test/api'
import { createTestDatabase } from '../test/database'

type Issued = {
  id: string
  state: string
  expiresAt: string
  payload: { version: number; enrollmentId: string; secret: string }
}

describe('enrollment HTTP routes', () => {
  let miniflare: Awaited<ReturnType<typeof createTestDatabase>>['miniflare']
  let database: D1Database
  let env: ReturnType<typeof testEnv>
  let cookie: string
  let recipientId: string

  beforeEach(async () => {
    ;({ database, miniflare } = await createTestDatabase())
    env = testEnv(database)
    cookie = await signInCaretaker(env)
    recipientId = (await createRecipient(env, cookie, 'Alex')).id
  })

  afterEach(async () => miniflare.dispose())

  const issue = async () => {
    const response = await json(
      env,
      `/api/recipients/${recipientId}/enrollments`,
      'POST',
      {},
      { cookie },
    )
    expect(response.status).toBe(201)
    return (await response.json()) as Issued
  }

  const claim = (issued: Issued, claimantSecret: string) =>
    json(env, '/api/enrollments/claim', 'POST', { payload: issued.payload, claimantSecret })

  const approve = (enrollmentId: string, matchingCode: string) =>
    json(env, `/api/enrollments/${enrollmentId}/approve`, 'POST', { matchingCode }, { cookie })

  const collect = (enrollmentId: string, claimantSecret: string) =>
    json(env, `/api/enrollments/${enrollmentId}/session`, 'POST', { claimantSecret })

  const sessionCount = async (userId?: string) =>
    (
      await database
        .prepare(
          userId
            ? 'SELECT COUNT(*) AS total FROM session WHERE userId = ?'
            : 'SELECT COUNT(*) AS total FROM session',
        )
        .bind(...(userId ? [userId] : []))
        .first<{ total: number }>()
    )?.total

  const recipientUserId = async () =>
    (
      await database
        .prepare('SELECT userId FROM recipient WHERE id = ?')
        .bind(recipientId)
        .first<{ userId: string }>()
    )?.userId as string

  test('issues a versioned payload and never returns secrets to the caretaker', async () => {
    const issued = await issue()
    expect(issued).toMatchObject({
      state: 'issued',
      payload: { version: 1, enrollmentId: issued.id },
    })
    expect(issued.payload.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const status = await request(env, `/api/enrollments/${issued.id}`, 'GET', {
      headers: { cookie },
    })
    const body = (await status.json()) as Record<string, unknown>
    expect(body).toEqual({
      id: issued.id,
      recipientId,
      state: 'issued',
      matchingCode: null,
      expiresAt: issued.expiresAt,
    })
    expect(JSON.stringify(body)).not.toContain(issued.payload.secret)
  })

  test('completes the handshake and grants access only after approval', async () => {
    const root = await saveTaskTree(env, cookie, '00000000-0000-4000-8000-000000000001', 'Morning')
    await request(env, `/api/recipients/${recipientId}/tasks/${root}`, 'PUT', {
      headers: { cookie },
    })

    const issued = await issue()
    const claimantSecret = generateSecret()
    const claimResponse = await claim(issued, claimantSecret)
    expect(claimResponse.status).toBe(200)
    const claimed = (await claimResponse.json()) as {
      matchingCode: string
      pollIntervalSeconds: number
    }
    expect(claimed.matchingCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(claimed.pollIntervalSeconds).toBe(3)

    // The caretaker sees the same code to compare against the device screen.
    const status = await request(env, `/api/enrollments/${issued.id}`, 'GET', {
      headers: { cookie },
    })
    expect(await status.json()).toMatchObject({
      state: 'claimed',
      matchingCode: claimed.matchingCode,
    })

    // Before approval the device has no session to collect.
    const pending = await collect(issued.id, claimantSecret)
    expect(pending.status).toBe(202)
    expect(await pending.json()).toMatchObject({ state: 'claimed', pollIntervalSeconds: 3 })
    expect(pending.headers.get('retry-after')).toBe('3')

    expect((await approve(issued.id, claimed.matchingCode)).status).toBe(200)

    const collected = await collect(issued.id, claimantSecret)
    expect(collected.status).toBe(200)
    expect(collected.headers.get('cache-control')).toBe('no-store')
    const session = (await collected.json()) as { token: string; tokenType: string }
    expect(session.tokenType).toBe('Bearer')
    expect(session).toMatchObject({ recipient: { id: recipientId, displayName: 'Alex' } })

    const tasks = await request(env, '/api/recipient/tasks', 'GET', {
      headers: bearer(session.token),
    })
    expect(tasks.status).toBe(200)
    expect(await tasks.json()).toMatchObject([{ id: root }])
  })

  test('lets only the first claimant win and lets that claimant retry', async () => {
    const issued = await issue()
    const winnerSecret = generateSecret()
    const loserSecret = generateSecret()

    const [first, second] = await Promise.all([
      claim(issued, winnerSecret),
      claim(issued, loserSecret),
    ])
    const outcomes = [first.status, second.status].sort()
    expect(outcomes).toEqual([200, 409])

    const winner = first.status === 200 ? winnerSecret : loserSecret
    const winningCode = (
      (await (first.status === 200 ? first : second).json()) as {
        matchingCode: string
      }
    ).matchingCode

    // A repeated request from the winner returns the same code.
    const retry = await claim(issued, winner)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ matchingCode: winningCode })

    // A different claimant cannot replace the binding or collect the session.
    const other = await claim(issued, generateSecret())
    expect(other.status).toBe(409)
    await approve(issued.id, winningCode)
    const stolen = await collect(issued.id, generateSecret())
    expect(stolen.status).toBe(404)
    expect(await stolen.json()).toMatchObject({
      type: 'urn:helping-hand:problem:enrollment-not-found',
    })
  })

  test('rejects an unknown enrollment and a wrong QR secret without revealing anything', async () => {
    const issued = await issue()
    const wrongSecret = await claim(
      { ...issued, payload: { ...issued.payload, secret: generateSecret() } },
      generateSecret(),
    )
    expect(wrongSecret.status).toBe(404)
    const body = (await wrongSecret.json()) as Record<string, string>
    expect(body.detail).toBe('The enrollment does not exist.')
    expect(JSON.stringify(body)).not.toContain('Alex')
    expect(JSON.stringify(body)).not.toContain(recipientId)
  })

  test('fails a stale approval and a mismatched confirmation code', async () => {
    const issued = await issue()
    const claimantSecret = generateSecret()
    const { matchingCode } = (await (await claim(issued, claimantSecret)).json()) as {
      matchingCode: string
    }

    const mismatch = await approve(issued.id, 'AAAAAA')
    expect(mismatch.status).toBe(409)
    expect(await sessionCount(await recipientUserId())).toBe(0)

    // Cancelling makes the previously displayed code unusable.
    expect(
      (await request(env, `/api/enrollments/${issued.id}`, 'DELETE', { headers: { cookie } }))
        .status,
    ).toBe(204)
    const stale = await approve(issued.id, matchingCode)
    expect(stale.status).toBe(409)
    expect(await sessionCount(await recipientUserId())).toBe(0)
    expect((await collect(issued.id, claimantSecret)).status).toBe(410)
  })

  test('approves once even when the caretaker approves twice at the same time', async () => {
    const issued = await issue()
    const claimantSecret = generateSecret()
    const { matchingCode } = (await (await claim(issued, claimantSecret)).json()) as {
      matchingCode: string
    }

    const [first, second] = await Promise.all([
      approve(issued.id, matchingCode),
      approve(issued.id, matchingCode),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 200])
    expect(await sessionCount(await recipientUserId())).toBe(1)

    const collected = await collect(issued.id, claimantSecret)
    expect(collected.status).toBe(200)
    const { token } = (await collected.json()) as { token: string }
    expect(
      (await request(env, '/api/recipient/me', 'GET', { headers: bearer(token) })).status,
    ).toBe(200)
  })

  test('redelivers the same session to the same claimant and then closes the window', async () => {
    const issued = await issue()
    const claimantSecret = generateSecret()
    const { matchingCode } = (await (await claim(issued, claimantSecret)).json()) as {
      matchingCode: string
    }
    await approve(issued.id, matchingCode)

    const first = (await (await collect(issued.id, claimantSecret)).json()) as { token: string }
    const second = await collect(issued.id, claimantSecret)
    expect(second.status).toBe(200)
    expect(((await second.json()) as { token: string }).token).toBe(first.token)
    expect(await sessionCount(await recipientUserId())).toBe(1)

    // Closing the delivery window stops collection but not the active session.
    await database
      .prepare('UPDATE enrollment SET deliveryExpiresAt = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', issued.id)
      .run()
    expect((await collect(issued.id, claimantSecret)).status).toBe(410)
    expect(
      (await request(env, '/api/recipient/me', 'GET', { headers: bearer(first.token) })).status,
    ).toBe(200)
  })

  test('expires an unclaimed and an unapproved enrollment', async () => {
    const issued = await issue()
    const claimantSecret = generateSecret()
    await database
      .prepare('UPDATE enrollment SET expiresAt = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', issued.id)
      .run()

    const expired = await claim(issued, claimantSecret)
    expect(expired.status).toBe(410)
    expect(await expired.json()).toMatchObject({
      type: 'urn:helping-hand:problem:enrollment-expired',
    })

    // An expired enrollment never reopens for another claimant.
    expect((await claim(issued, generateSecret())).status).toBe(410)

    // A new enrollment can still be issued for the same recipient.
    const replacement = await issue()
    expect(replacement.id).not.toBe(issued.id)
  })

  test('cancels the previous open enrollment when a new one is issued', async () => {
    const first = await issue()
    const claimantSecret = generateSecret()
    const { matchingCode } = (await (await claim(first, claimantSecret)).json()) as {
      matchingCode: string
    }

    const second = await issue()
    expect((await approve(first.id, matchingCode)).status).toBe(409)
    expect(
      await (
        await request(env, `/api/enrollments/${first.id}`, 'GET', { headers: { cookie } })
      ).json(),
    ).toMatchObject({ state: 'cancelled' })

    const secondSecret = generateSecret()
    const secondClaim = (await (await claim(second, secondSecret)).json()) as {
      matchingCode: string
    }
    expect((await approve(second.id, secondClaim.matchingCode)).status).toBe(200)
  })

  test('replaces a device without losing assignments and revokes the old session', async () => {
    const root = await saveTaskTree(env, cookie, '00000000-0000-4000-8000-000000000001', 'Morning')
    await request(env, `/api/recipients/${recipientId}/tasks/${root}`, 'PUT', {
      headers: { cookie },
    })
    const original = await enrollDevice(env, cookie, recipientId)

    // The old device keeps access while a replacement is being prepared.
    const replacement = await issue()
    const claimantSecret = generateSecret()
    const { matchingCode } = (await (await claim(replacement, claimantSecret)).json()) as {
      matchingCode: string
    }
    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(original.token) }))
        .status,
    ).toBe(200)

    await approve(replacement.id, matchingCode)
    const { token } = (await (await collect(replacement.id, claimantSecret)).json()) as {
      token: string
    }

    expect(
      (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(original.token) }))
        .status,
    ).toBe(401)
    expect(
      await (await request(env, '/api/recipient/tasks', 'GET', { headers: bearer(token) })).json(),
    ).toMatchObject([{ id: root }])
    expect(await sessionCount(await recipientUserId())).toBe(1)
  })

  test('refuses enrollment for a disabled recipient and cancels its pending enrollment', async () => {
    const issued = await issue()
    await json(env, `/api/recipients/${recipientId}`, 'PATCH', { isActive: false }, { cookie })

    expect(
      await (
        await request(env, `/api/enrollments/${issued.id}`, 'GET', { headers: { cookie } })
      ).json(),
    ).toMatchObject({ state: 'cancelled' })

    const refused = await json(
      env,
      `/api/recipients/${recipientId}/enrollments`,
      'POST',
      {},
      { cookie },
    )
    expect(refused.status).toBe(409)
    expect(await sessionCount(await recipientUserId())).toBe(0)
  })

  test('keeps enrollment scoped to the owning caretaker', async () => {
    const other = await signInCaretaker(env, 'other@example.com')
    const issued = await issue()

    expect(
      (await request(env, `/api/enrollments/${issued.id}`, 'GET', { headers: { cookie: other } }))
        .status,
    ).toBe(404)
    expect(
      (await json(env, `/api/recipients/${recipientId}/enrollments`, 'POST', {}, { cookie: other }))
        .status,
    ).toBe(404)
    expect((await approve(issued.id, 'AAAAAA')).status).toBe(409)
  })

  test('validates the payload version, secret shape, and confirmation code shape', async () => {
    const issued = await issue()
    const invalid = await Promise.all([
      json(env, '/api/enrollments/claim', 'POST', {
        payload: { ...issued.payload, version: 2 },
        claimantSecret: generateSecret(),
      }),
      json(env, '/api/enrollments/claim', 'POST', {
        payload: issued.payload,
        claimantSecret: 'short',
      }),
      json(
        env,
        `/api/enrollments/${issued.id}/approve`,
        'POST',
        { matchingCode: 'no' },
        { cookie },
      ),
    ])
    expect(invalid.map(({ status }) => status)).toEqual([400, 400, 400])
  })
})
