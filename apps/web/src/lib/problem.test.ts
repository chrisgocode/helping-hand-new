import { describe, expect, it } from 'vitest'
import { PROBLEM, problemTypeOf, retryAfterSeconds } from './problem'

describe('problemTypeOf', () => {
  it('reads the type from a problem body', () => {
    expect(problemTypeOf({ type: PROBLEM.enrollmentConflict, title: 'Enrollment conflict' })).toBe(
      PROBLEM.enrollmentConflict,
    )
  })

  it('treats anything that is not a problem body as untyped', () => {
    expect(problemTypeOf(undefined)).toBeNull()
    expect(problemTypeOf(null)).toBeNull()
    expect(problemTypeOf('Internal Server Error')).toBeNull()
    expect(problemTypeOf({})).toBeNull()
    expect(problemTypeOf({ type: 42 })).toBeNull()
  })
})

describe('retryAfterSeconds', () => {
  it('reads the header the API sends', () => {
    const response = new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    expect(retryAfterSeconds(response)).toBe(60)
  })

  it('ignores a missing or unusable header', () => {
    expect(retryAfterSeconds(new Response(null, { status: 429 }))).toBeNull()
    expect(
      retryAfterSeconds(new Response(null, { status: 429, headers: { 'Retry-After': 'soon' } })),
    ).toBeNull()
    expect(
      retryAfterSeconds(new Response(null, { status: 429, headers: { 'Retry-After': '0' } })),
    ).toBeNull()
  })
})
