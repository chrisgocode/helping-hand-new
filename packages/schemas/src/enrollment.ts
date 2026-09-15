import { z } from 'zod'

/**
 * Enrollment timings. These are security parameters with deliberately short
 * windows, not product settings.
 */
export const ENROLLMENT_TIMINGS = {
  /** How long an issued QR code can be claimed and approved. */
  claimSeconds: 600,
  /** How long an approved session can be collected by the bound claimant. */
  deliverySeconds: 300,
  /** How often a bound claimant should poll for approval. */
  pollIntervalSeconds: 3,
} as const

/** Version of the payload encoded into the QR code. */
export const ENROLLMENT_PAYLOAD_VERSION = 1

/** 32 random bytes encoded as unpadded base64url. */
export const enrollmentSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/** Visual confirmation value only. It is never an authentication credential. */
export const matchingCodeSchema = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)

export const enrollmentStateSchema = z.enum([
  'issued',
  'claimed',
  'approved',
  'delivered',
  'cancelled',
  'expired',
])

export const enrollmentPayloadSchema = z.strictObject({
  version: z.literal(ENROLLMENT_PAYLOAD_VERSION),
  enrollmentId: z.uuid(),
  secret: enrollmentSecretSchema,
})

export const issuedEnrollmentSchema = z.strictObject({
  id: z.uuid(),
  state: enrollmentStateSchema,
  payload: enrollmentPayloadSchema,
  expiresAt: z.iso.datetime(),
})

export const enrollmentStatusSchema = z.strictObject({
  id: z.uuid(),
  recipientId: z.uuid(),
  state: enrollmentStateSchema,
  matchingCode: matchingCodeSchema.nullable(),
  expiresAt: z.iso.datetime(),
})

export const claimEnrollmentInputSchema = z.strictObject({
  payload: enrollmentPayloadSchema,
  claimantSecret: enrollmentSecretSchema,
})

export const enrollmentClaimSchema = z.strictObject({
  enrollmentId: z.uuid(),
  matchingCode: matchingCodeSchema,
  expiresAt: z.iso.datetime(),
  pollIntervalSeconds: z.number().int().positive(),
})

export const approveEnrollmentInputSchema = z.strictObject({
  matchingCode: matchingCodeSchema,
})

export const collectEnrollmentInputSchema = z.strictObject({
  claimantSecret: enrollmentSecretSchema,
})

export const pendingEnrollmentSessionSchema = z.strictObject({
  state: z.literal('claimed'),
  pollIntervalSeconds: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
})

/**
 * What a device keeps about an enrollment attempt in progress, written before
 * the claim is sent so a restarted app can recover it. `matchingCode` and
 * `claimExpiresAt` stay null until the claim succeeds.
 */
export const persistedEnrollmentSchema = z.strictObject({
  payload: enrollmentPayloadSchema,
  claimantSecret: enrollmentSecretSchema,
  matchingCode: matchingCodeSchema.nullable(),
  pollIntervalSeconds: z.number().int().positive(),
  claimExpiresAt: z.iso.datetime().nullable(),
})

export const recipientSessionSchema = z.strictObject({
  token: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresAt: z.iso.datetime(),
  recipient: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1).max(100),
  }),
})

export type EnrollmentState = z.infer<typeof enrollmentStateSchema>
export type EnrollmentPayload = z.infer<typeof enrollmentPayloadSchema>
export type IssuedEnrollment = z.infer<typeof issuedEnrollmentSchema>
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>
export type ClaimEnrollmentInput = z.infer<typeof claimEnrollmentInputSchema>
export type EnrollmentClaim = z.infer<typeof enrollmentClaimSchema>
export type ApproveEnrollmentInput = z.infer<typeof approveEnrollmentInputSchema>
export type CollectEnrollmentInput = z.infer<typeof collectEnrollmentInputSchema>
export type PendingEnrollmentSession = z.infer<typeof pendingEnrollmentSessionSchema>
export type PersistedEnrollment = z.infer<typeof persistedEnrollmentSchema>
export type RecipientSession = z.infer<typeof recipientSessionSchema>
