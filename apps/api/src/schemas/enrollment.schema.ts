import {
  approveEnrollmentInputSchema,
  claimEnrollmentInputSchema,
  collectEnrollmentInputSchema,
  enrollmentClaimSchema,
  enrollmentStatusSchema,
  issuedEnrollmentSchema,
  pendingEnrollmentSessionSchema,
  recipientSessionSchema,
} from '@helping-hand/schemas'
import { createRoute, z } from '@hono/zod-openapi'
import { rateLimit } from '../middleware/rate-limit'
import { requireCaretaker } from '../middleware/require-auth'
import { caretakerErrors, caretakerSecurity, jsonBody, problemResponse } from './http.schema'
import { recipientIdParamsSchema } from './recipient.schema'

const enrollmentIdParamsSchema = z.object({
  enrollmentId: z.uuid().openapi({ param: { name: 'enrollmentId', in: 'path' } }),
})

/** Pre-auth routes are identified by the enrollment secrets in the request. */
const claimantErrors = {
  400: problemResponse('The request is invalid'),
  404: problemResponse('The enrollment does not exist or the secret does not match'),
  410: problemResponse('The enrollment expired'),
  429: problemResponse('The enrollment rate limit was exceeded'),
  500: problemResponse('The request could not be completed'),
}

export const issueEnrollmentRoute = createRoute({
  method: 'post',
  path: '/{recipientId}/enrollments',
  operationId: 'issueEnrollment',
  tags: ['Enrollments'],
  summary: 'Issue an enrollment QR code for a recipient',
  description: 'Issuing cancels any enrollment already open for the recipient.',
  security: caretakerSecurity,
  middleware: [requireCaretaker, rateLimit('enrollment', 'recipientId')] as const,
  request: { params: recipientIdParamsSchema },
  responses: {
    201: {
      description: 'The issued enrollment and its QR payload',
      content: { 'application/json': { schema: issuedEnrollmentSchema } },
    },
    404: problemResponse('The recipient does not exist'),
    409: problemResponse('The recipient is disabled'),
    ...caretakerErrors('The enrollment rate limit was exceeded'),
  },
})

export const getEnrollmentRoute = createRoute({
  method: 'get',
  path: '/{enrollmentId}',
  operationId: 'getEnrollment',
  tags: ['Enrollments'],
  summary: 'Get enrollment state and, after a claim, the confirmation code',
  description: 'Session and claimant secrets are never returned.',
  security: caretakerSecurity,
  middleware: [requireCaretaker, rateLimit('enrollment', 'enrollmentId')] as const,
  request: { params: enrollmentIdParamsSchema },
  responses: {
    200: {
      description: 'The enrollment state',
      content: { 'application/json': { schema: enrollmentStatusSchema } },
    },
    404: problemResponse('The enrollment does not exist'),
    ...caretakerErrors('The enrollment rate limit was exceeded'),
  },
})

export const approveEnrollmentRoute = createRoute({
  method: 'post',
  path: '/{enrollmentId}/approve',
  operationId: 'approveEnrollment',
  tags: ['Enrollments'],
  summary: 'Confirm the displayed code and activate the recipient device',
  description:
    'Activation replaces the recipient session and revokes the previous device in one state change.',
  security: caretakerSecurity,
  middleware: [requireCaretaker, rateLimit('enrollment', 'enrollmentId')] as const,
  request: {
    params: enrollmentIdParamsSchema,
    body: jsonBody(approveEnrollmentInputSchema),
  },
  responses: {
    200: {
      description: 'The approved enrollment',
      content: { 'application/json': { schema: enrollmentStatusSchema } },
    },
    400: problemResponse('The approval is invalid'),
    404: problemResponse('The enrollment does not exist'),
    409: problemResponse('The confirmation code or enrollment state does not match'),
    410: problemResponse('The enrollment expired'),
    ...caretakerErrors('The enrollment rate limit was exceeded'),
  },
})

export const cancelEnrollmentRoute = createRoute({
  method: 'delete',
  path: '/{enrollmentId}',
  operationId: 'cancelEnrollment',
  tags: ['Enrollments'],
  summary: 'Cancel an enrollment',
  description:
    'Cancelling cannot undo an already active session. Revoke recipient access for that.',
  security: caretakerSecurity,
  middleware: [requireCaretaker, rateLimit('enrollment', 'enrollmentId')] as const,
  request: { params: enrollmentIdParamsSchema },
  responses: {
    204: { description: 'The enrollment is cancelled' },
    404: problemResponse('The enrollment does not exist'),
    ...caretakerErrors('The enrollment rate limit was exceeded'),
  },
})

export const claimEnrollmentRoute = createRoute({
  method: 'post',
  path: '/claim',
  operationId: 'claimEnrollment',
  tags: ['Enrollments'],
  summary: 'Bind a scanned enrollment to this device',
  description:
    'No authentication is required; the scanned QR secret authorizes the claim. Repeating the request with the same claimant secret returns the same confirmation code.',
  middleware: [rateLimit('enrollment')] as const,
  request: { body: jsonBody(claimEnrollmentInputSchema) },
  responses: {
    200: {
      description: 'The confirmation code to display to the caretaker',
      content: { 'application/json': { schema: enrollmentClaimSchema } },
    },
    409: problemResponse('The enrollment was already claimed by another device'),
    ...claimantErrors,
  },
})

export const collectEnrollmentSessionRoute = createRoute({
  method: 'post',
  path: '/{enrollmentId}/session',
  operationId: 'collectEnrollmentSession',
  tags: ['Enrollments'],
  summary: 'Poll for approval or collect the approved session',
  description:
    'Returns 202 while approval is pending. On success the bearer token is returned in the body with Cache-Control: no-store and may be collected again by the same claimant until the delivery window closes.',
  middleware: [rateLimit('enrollment', 'enrollmentId')] as const,
  request: {
    params: enrollmentIdParamsSchema,
    body: jsonBody(collectEnrollmentInputSchema),
  },
  responses: {
    200: {
      description: 'The approved recipient session',
      content: { 'application/json': { schema: recipientSessionSchema } },
      headers: z.object({
        'Cache-Control': z.string().openapi({ example: 'no-store' }),
      }),
    },
    202: {
      description: 'Approval is still pending',
      content: { 'application/json': { schema: pendingEnrollmentSessionSchema } },
    },
    ...claimantErrors,
  },
})
