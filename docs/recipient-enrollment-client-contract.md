# Recipient enrollment client contract

What a caretaker web client and a recipient device client have to do against the implemented API. The authoritative shapes are in `apps/api/openapi.json` and `packages/api-client/src/generated.ts`; this describes the duties the contract cannot express.

## Roles and credentials

- A **caretaker** authenticates with the Better Auth session cookie, or with the same session as a bearer token from a native client.
- A **recipient device** authenticates only with a bearer token collected at the end of an enrollment: `Authorization: Bearer <token>`.
- `createApiClient({ baseUrl, headers })` accepts the bearer header for every request; the caretaker web client keeps using cookies.

## Recipient deletion

`DELETE /api/recipients/{recipientId}` permanently removes the recipient's identity, device sessions, assignments, and enrollment history. The caretaker's task trees remain. The caretaker client must confirm this destructive action and treat `204` as success; a missing recipient or one belonging to another caretaker returns `404`.

## Enrollment handshake

| Step | Caller | Request |
| --- | --- | --- |
| 1. Issue | Caretaker | `POST /api/recipients/{recipientId}/enrollments` |
| 2. Claim | Device | `POST /api/enrollments/claim` |
| 3. Compare | Both | Caretaker polls `GET /api/enrollments/{enrollmentId}` |
| 4. Approve | Caretaker | `POST /api/enrollments/{enrollmentId}/approve` |
| 5. Collect | Device | `POST /api/enrollments/{enrollmentId}/session` |

```text
issued -> claimed -> approved -> delivered
   |         |
   +---------+----> cancelled / expired
```

### Caretaker client

1. Render the `payload` object from the issue response as a QR code. Do not put it in a URL or a query string.
2. Poll the enrollment until `state` is `claimed`, then show `matchingCode` next to the device's screen.
3. Send the code the caretaker confirmed in the approve request. A code that no longer matches returns `409`, which is the point: it catches a stale screen.
4. `DELETE /api/enrollments/{enrollmentId}` cancels an enrollment in progress. It cannot undo an already active session; use `DELETE /api/recipients/{recipientId}/session` for that.

### Recipient device client

1. Decode the QR payload and **reject any `version` the client does not understand**. The payload is `{ version, enrollmentId, secret }`.
2. Generate a claimant secret — 32 random bytes, unpadded base64url — and store it in platform secure storage *before* sending the claim. It is the only way to repeat a request whose response was lost.
3. Send the claim, display the returned `matchingCode`, and poll `POST /api/enrollments/{enrollmentId}/session` with the same claimant secret. `202` means approval is still pending; honour `pollIntervalSeconds` and back off on repeated failures.
4. On `200`, store `token` in platform secure storage. Discard the claimant secret.
5. If the collection response is lost, repeat the same request. The same session is redelivered to the same claimant until the delivery window closes; after that, ask the caretaker for a new enrollment.

## Timings

| Window | Value |
| --- | --- |
| Claim and approve an issued enrollment | 10 minutes |
| Collect an approved session | 5 minutes |
| Suggested poll interval | 3 seconds |

These are security parameters, not user settings. They are named constants in `packages/schemas/src/enrollment.ts` (`ENROLLMENT_TIMINGS`).

## After enrollment

- `GET /api/recipient/me` returns the recipient identity and `sessionExpiresAt`.
- `GET /api/recipient/tasks` returns the complete assigned task trees, or an empty list. Nodes carry `id`, `title`, `durationSeconds`, and `children` only — no category, revision, or caretaker metadata.
- A `401` on either route means access ended: the caretaker revoked it, disabled the recipient, or replaced the device. Clear the stored token **and any cached task data** and return to the enrollment screen. An expired session needs a caretaker-assisted enrollment again.
- Guided-session navigation stays in the client. The API stores no position or completion state.

## Problem types

Errors use `application/problem+json` with a stable `type`:

| Type | Status | Meaning |
| --- | --- | --- |
| `urn:helping-hand:problem:validation` | 400 | The request or payload version is invalid |
| `urn:helping-hand:problem:unauthorized` | 401 | Not signed in, or the device is no longer enrolled |
| `urn:helping-hand:problem:forbidden` | 403 | Authenticated, but the wrong role for this operation |
| `urn:helping-hand:problem:not-found` | 404 | A caretaker-scoped record does not exist or belongs to someone else |
| `urn:helping-hand:problem:enrollment-not-found` | 404 | Unknown enrollment, or a secret that does not match |
| `urn:helping-hand:problem:conflict` | 409 | A recipient or assignment limit was reached |
| `urn:helping-hand:problem:enrollment-conflict` | 409 | Already claimed, wrong confirmation code, or the wrong state |
| `urn:helping-hand:problem:enrollment-expired` | 410 | The enrollment or its delivery window closed |
| `urn:helping-hand:problem:rate-limited` | 429 | Retry after the `Retry-After` header |

An invalid claimant is told nothing about the recipient or the enrollment beyond "does not exist".
