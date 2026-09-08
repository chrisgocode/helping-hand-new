import '@hono/zod-openapi'
import {
  enrollmentClaimSchema,
  enrollmentStatusSchema,
  issuedEnrollmentSchema,
  recipientSessionSchema,
} from '@helping-hand/schemas'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  approveEnrollment,
  cancelEnrollment,
  claimEnrollment,
  collectEnrollmentSession,
  getEnrollment,
  handleEnrollmentError,
  issueEnrollment,
} from '../controllers/enrollment.controller'
import {
  approveEnrollmentRoute,
  cancelEnrollmentRoute,
  claimEnrollmentRoute,
  collectEnrollmentSessionRoute,
  getEnrollmentRoute,
  issueEnrollmentRoute,
} from '../schemas/enrollment.schema'
import type { ApiEnv } from '../types/api'

/** Enrollment inspection, approval, claiming, and collection at `/api/enrollments`. */
export const enrollmentRoutes = new OpenAPIHono<ApiEnv>()

enrollmentRoutes.openAPIRegistry.register('IssuedEnrollment', issuedEnrollmentSchema)
enrollmentRoutes.openAPIRegistry.register('EnrollmentStatus', enrollmentStatusSchema)
enrollmentRoutes.openAPIRegistry.register('EnrollmentClaim', enrollmentClaimSchema)
enrollmentRoutes.openAPIRegistry.register('RecipientSession', recipientSessionSchema)

// The literal `/claim` path is registered before `/{enrollmentId}` variants.
enrollmentRoutes.openapi(claimEnrollmentRoute, claimEnrollment)
enrollmentRoutes.openapi(getEnrollmentRoute, getEnrollment)
enrollmentRoutes.openapi(cancelEnrollmentRoute, cancelEnrollment)
enrollmentRoutes.openapi(approveEnrollmentRoute, approveEnrollment)
enrollmentRoutes.openapi(collectEnrollmentSessionRoute, collectEnrollmentSession)
enrollmentRoutes.onError(handleEnrollmentError)

/** Enrollment issuing hangs off the recipient it belongs to, at `/api/recipients`. */
export const recipientEnrollmentRoutes = new OpenAPIHono<ApiEnv>()

recipientEnrollmentRoutes.openapi(issueEnrollmentRoute, issueEnrollment)
recipientEnrollmentRoutes.onError(handleEnrollmentError)
