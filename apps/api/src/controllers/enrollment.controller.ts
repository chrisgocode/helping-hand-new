import type { RouteHandler } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { audit } from '../lib/audit'
import { serviceErrorHandler } from '../lib/service-error'
import type {
  approveEnrollmentRoute,
  cancelEnrollmentRoute,
  claimEnrollmentRoute,
  collectEnrollmentSessionRoute,
  getEnrollmentRoute,
  issueEnrollmentRoute,
} from '../schemas/enrollment.schema'
import { EnrollmentService, EnrollmentServiceError } from '../services/enrollment.service'
import { serviceOptions } from '../services/service-options'
import type { ApiEnv } from '../types/api'

function enrollmentService(c: Context<ApiEnv>) {
  return new EnrollmentService(serviceOptions(c))
}

export const issueEnrollment: RouteHandler<typeof issueEnrollmentRoute, ApiEnv> = async (c) => {
  const { recipientId } = c.req.valid('param')
  const enrollment = await enrollmentService(c).issueEnrollment(
    c.get('authenticatedUserId'),
    recipientId,
  )
  audit(c, 'enrollment_issued', { recipientId, enrollmentId: enrollment.id })
  return c.json(enrollment, 201)
}

export const getEnrollment: RouteHandler<typeof getEnrollmentRoute, ApiEnv> = async (c) =>
  c.json(
    await enrollmentService(c).getEnrollment(
      c.get('authenticatedUserId'),
      c.req.valid('param').enrollmentId,
    ),
    200,
  )

export const cancelEnrollment: RouteHandler<typeof cancelEnrollmentRoute, ApiEnv> = async (c) => {
  const { enrollmentId } = c.req.valid('param')
  await enrollmentService(c).cancelEnrollment(c.get('authenticatedUserId'), enrollmentId)
  audit(c, 'enrollment_cancelled', { enrollmentId })
  return c.body(null, 204)
}

export const approveEnrollment: RouteHandler<typeof approveEnrollmentRoute, ApiEnv> = async (c) => {
  const { enrollmentId } = c.req.valid('param')
  const status = await enrollmentService(c).approveEnrollment(
    c.get('authenticatedUserId'),
    enrollmentId,
    c.req.valid('json'),
  )
  audit(c, 'enrollment_approved', { enrollmentId, recipientId: status.recipientId })
  return c.json(status, 200)
}

export const claimEnrollment: RouteHandler<typeof claimEnrollmentRoute, ApiEnv> = async (c) => {
  const claim = await enrollmentService(c).claimEnrollment(c.req.valid('json'))
  audit(c, 'enrollment_claimed', { enrollmentId: claim.enrollmentId })
  return c.json(claim, 200)
}

export const collectEnrollmentSession: RouteHandler<
  typeof collectEnrollmentSessionRoute,
  ApiEnv
> = async (c) => {
  const { enrollmentId } = c.req.valid('param')
  const result = await enrollmentService(c).collectSession(enrollmentId, c.req.valid('json'))
  if ('state' in result) {
    return c.json(result, 202, { 'Retry-After': String(result.pollIntervalSeconds) })
  }
  audit(c, 'enrollment_session_delivered', { enrollmentId })
  return c.json(result, 200, { 'Cache-Control': 'no-store' })
}

export const handleEnrollmentError = serviceErrorHandler(EnrollmentServiceError, {
  invalid: {
    type: 'urn:helping-hand:problem:validation',
    title: 'Invalid request',
    status: 400,
  },
  not_found: {
    type: 'urn:helping-hand:problem:enrollment-not-found',
    title: 'Enrollment not found',
    // A claimant learns nothing about an enrollment it cannot prove it owns.
    detail: 'The enrollment does not exist.',
    status: 404,
  },
  expired: {
    type: 'urn:helping-hand:problem:enrollment-expired',
    title: 'Enrollment expired',
    status: 410,
  },
  conflict: {
    type: 'urn:helping-hand:problem:enrollment-conflict',
    title: 'Enrollment conflict',
    status: 409,
  },
})
