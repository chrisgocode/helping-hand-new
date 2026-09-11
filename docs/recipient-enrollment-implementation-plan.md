# Recipient enrollment and task access implementation plan

Status: implementation plan for the backend and caretaker web client.

## 1. Agreed behavior

- One caretaker can manage several recipients. A recipient belongs to exactly one caretaker.
- A caretaker can permanently delete one of their recipients. Deletion ends device access and removes the recipient's identity, assignments, and enrollments without deleting the caretaker's task trees.
- A caretaker can assign a root task and its complete task tree to several recipients.
- Recipients can read only their assigned task trees. Guided-session navigation stays in the frontend; no completion or navigation state is stored by this change.
- The caretaker selects a recipient and displays a QR code. After the recipient scans it, both devices display a matching code. The caretaker checks the match and approves enrollment.
- Enrollment signs in the recipient under a separate identity. It never issues the caretaker's credentials to the recipient.
- Replacing a device uses the same recipient record and assignments. Successful approval revokes access from the previous device session.
- This work covers the backend, shared schemas, generated contracts, tests, integration documentation, and caretaker web screens including QR rendering. Recipient-device camera scanning, glasses display, and mobile secure storage implementation come later.

## 2. Current code and proposed architecture

The backend uses Hono, Better Auth, and Cloudflare D1. `auth.ts` currently enables email/password authentication. `resolveAuth` retains only the user ID. Task and category handlers pass that ID into caretaker-scoped queries. The mobile directory currently contains only a platform-selection note.

Follow the existing data flow for all new recipient and enrollment operations:

```text
routes → controller → service → D1
```

- **Routes** declare paths, OpenAPI contracts, request validation, and middleware, then delegate to controller handlers. Routes do not instantiate services or execute business logic.
- **Controllers** translate validated HTTP inputs and authenticated actor context into service calls, then translate results and domain errors into HTTP responses. Controllers do not query D1 or implement enrollment or assignment rules.
- **Services** own recipient permissions, task assignments, enrollment transitions, session coordination, and D1 queries/transactions. Better Auth integration stays behind the service interface.
- **D1** persists data and enforces database constraints. Services access the existing D1 binding directly; no additional repository layer is needed.

Keep shared validation schemas in the existing schema packages and HTTP contracts in the existing HTTP-schema convention. Add two focused modules:

| Module | Interface responsibilities | Behavior kept inside |
| --- | --- | --- |
| Recipient management | Create/list/update/delete recipients; assign/unassign root tasks; read assigned task trees; revoke recipient access | Caretaker ownership, recipient lifecycle, assignment validation, active-session checks, and access-scoped queries |
| Enrollment | Issue, claim, inspect, approve, cancel, and collect enrollment | Secrets, expiry, matching codes, state transitions, concurrent requests, session activation, replacement, and recovery |

These modules provide depth through a small interface. Controllers are transport adapters at that seam. Database and authentication details stay inside the service implementation. This gives callers leverage and keeps security changes local. Apply the deletion test: removing these modules would distribute their rules across controllers and clients.

Extend the existing task module to query an authorized subset of task trees and reuse its tree reconstruction, ordering, and duration calculation. Do not copy that logic or load every caretaker task into a handler and rely on frontend filtering. A new generic repository or permission framework is unnecessary.

## 3. Phase 1 — Prove the authentication integration

Complete this focused integration check before freezing the migration or mobile contract:

1. Inspect the locked Better Auth version and its supported custom-plugin context for creating a credential-free user and issuing a database-backed session.
2. Verify bearer authentication through the existing `getSession` flow, including the exact token representation required by the Bearer plugin.
3. Prove that a recipient session cannot be used before activation, that the same session can be safely delivered again after a lost response, and that replacement prevents the previous session from accessing the backend.
4. Exercise this against the project's Miniflare D1 test database. Do not assume multiple Better Auth calls automatically participate in a D1 transaction.

Use Better Auth for session generation and validation. Add the smallest supported custom enrollment integration needed; do not build a second JWT/refresh-token system or expose an unrestricted anonymous-signup route.

The current user table requires a unique email. If the supported creation path requires one, use a server-generated address under a reserved `.invalid` domain, with no password credential and no email verification claim. It is an internal compatibility value, excluded from recipient responses. Prevent recipient password setup, email changes, and account linking from becoming alternate enrollment paths.

Acceptance: a runnable integration check demonstrates credential-free recipient creation, bearer authentication, session recovery, and revocation using the pinned version. Any library limitation is resolved here, before dependent work.

## 4. Phase 2 — Add the data model and migration

Use an additive migration after the existing migrations. Preserve existing users, task trees, categories, and sessions.

| Record | Proposed fields and constraints |
| --- | --- |
| Auth user | Server-controlled account kind: `caretaker` or `recipient`. Backfill existing users as caretakers; ordinary signup creates caretakers. Reject client-supplied account-kind changes. |
| Recipient | Stable ID, unique auth-user ID, caretaker ID, display name, active/disabled state, active session reference, timestamps. Caretaker ID is required and has no transfer operation in this version. |
| Task assignment | Recipient ID, root-task ID, caretaker ID, creation time. Unique recipient/root pair. Composite foreign keys enforce that both records belong to the same caretaker. |
| Enrollment | ID, recipient ID, QR-secret hash, claimant-secret hash once claimed, matching code, state, expiry, approved session reference if needed, timestamps. |

Implementation constraints:

- Validate that an assignment targets a root task. Enforce this in the database where practical and test the invariant through the assignment interface; foreign keys alone cannot enforce `parentId IS NULL`.
- Add indexes for recipient-by-caretaker lookup, assignment lookup by recipient/root, and enrollment lookup/expiry.
- Allow at most one open enrollment per recipient. Issuing a new QR cancels the previous open enrollment atomically.
- Deleting a task tree removes its assignments. Editing a task tree preserves them. Changes to a shared tree appear for every assigned recipient on their next fetch.
- Disabling a recipient preserves assignments but revokes access and cancels pending enrollment. Re-enabling alone does not restore a previous session.
- A revoked session must not leave a dangling active-session reference that breaks later enrollment.

The exact auth-user creation and session-reference fields follow the Phase 1 check. The domain constraints above are fixed.

Acceptance: migrations work on a fresh database and a database with existing caretaker data. Invalid cross-caretaker assignments and duplicate assignments fail without partial writes.

## 5. Phase 3 — Establish identity and permissions

Extend request authentication to retain the actor's user ID, account kind, and session ID. Never replace the actor's ID with the caretaker's ID.

- Caretaker operations require a caretaker identity and ownership of the recipient/task being modified.
- Recipient requests require a valid Better Auth session, an active recipient record, and a match with the recipient's active session reference.
- Recipient task reads also require current assignments. Revoked assignments disappear on the next request.
- Existing caretaker task/category routes reject recipient credentials. AI proposal routes explicitly reject recipient credentials too; retain their current guest behavior for unauthenticated callers.
- Review the existing `/api/auth/*` handler surface. Permit only appropriate recipient session operations, and block recipient account mutation or new credential creation.
- Use `401` for missing/invalid/inactive sessions, `403` for an authenticated role that cannot perform the operation, and `404` for caretaker-scoped records that do not exist or belong to someone else.

Check access in authoritative database reads. Do not introduce session or relationship caching that permits stale access after revocation. A response already downloaded cannot be withdrawn; mobile cache clearing is a later frontend requirement.

Acceptance: a recipient cannot use any existing task/category mutation or AI proposal operation, and a caretaker cannot manage another caretaker's recipients or assignments.

## 6. Phase 4 — Implement recipients and assignments

Proposed HTTP contract, using the existing problem-details format:

| Method and path | Caller | Behavior |
| --- | --- | --- |
| `POST /api/recipients` | Caretaker | Create a recipient profile and stable credential-free identity; return `201`. No device is signed in. |
| `GET /api/recipients` | Caretaker | List the caretaker's recipients and enrollment/access status without secrets. |
| `PATCH /api/recipients/{recipientId}` | Owning caretaker | Update display name or active/disabled state. |
| `DELETE /api/recipients/{recipientId}` | Owning caretaker | Permanently delete the recipient identity, profile, assignments, enrollments, and sessions; return `204`. Task trees are preserved. |
| `GET /api/recipients/{recipientId}/tasks` | Owning caretaker | List assigned root-task IDs. |
| `PUT /api/recipients/{recipientId}/tasks/{taskId}` | Owning caretaker | Idempotently assign the complete task tree; `taskId` must identify a root task; return `204`. |
| `DELETE /api/recipients/{recipientId}/tasks/{taskId}` | Owning caretaker | Idempotently remove that assignment; `taskId` must identify a root task; return `204`. |
| `DELETE /api/recipients/{recipientId}/session` | Owning caretaker | Revoke device access and cancel pending enrollment; preserve recipient and assignments. |
| `GET /api/recipient/me` | Active recipient | Return minimal recipient identity and session-expiry information. |
| `GET /api/recipient/tasks` | Active recipient | Return only complete assigned task trees; return an empty list when none are assigned. |

Reuse the task-tree schema if it contains only appropriate recipient fields. Omit caretaker-only metadata or narrow the recipient schema if required. Do not expose the caretaker's full category collection through recipient reads.

### Permanent recipient deletion

Implement deletion as one vertical slice through the existing `routes → controller → service → D1` flow:

1. Add `deleteRecipientRoute` beside the other recipient routes. Reuse `recipientIdParamsSchema`, `caretakerSecurity`, `requireCaretaker`, and `caretakerErrors()`. It has no request body, returns `204`, and returns the same `404` for a missing recipient and another caretaker's recipient.
2. Add a controller handler that passes the authenticated caretaker ID and recipient ID to `RecipientService`, audits `recipient_deleted` with the recipient ID only after success, and returns an empty `204` response.
3. Add `RecipientService.deleteRecipient`. Resolve ownership with `#ownedRecipient`, then call the existing `RecipientAuth.deleteUser(userId)`. The current foreign keys perform the cleanup: deleting the synthetic auth user cascades to its sessions and recipient profile, and deleting the profile cascades to assignments and enrollments. Task trees remain because deletion removes only their assignment rows. Add no migration or manual cleanup queries.
4. Regenerate `apps/api/openapi.json` and `packages/api-client/src/generated.ts`; document the permanent operation in the client contract.
5. In the caretaker web client, add the generated client call and a destructive confirmation on the recipient detail page. State exactly what is removed, navigate to the recipient list only after `204`, retain the page with an actionable error after failure, and advise deletion—not disabling—when the recipient limit is reached.

Prove the slice with real Miniflare D1 HTTP tests: the owning caretaker receives `204`; a missing or foreign recipient receives `404`; the deleted device token receives `401`; the recipient disappears from the list; its enrollment and assignments are gone; its task trees remain; and deleting one of 25 recipients permits creating a replacement. Use one direct database assertion only to prove the internal synthetic auth-user row was removed, because no public endpoint exposes it.

Acceptance: two recipients can share one tree and have different additional trees. Unassigned and other-caretaker tasks never appear, including descendants or metadata. Deleting a recipient permanently removes their access and dependent records, preserves the caretaker's task trees, and immediately frees one recipient-limit slot.

## 7. Phase 5 — Implement enrollment and replacement

Proposed HTTP contract:

| Method and path | Caller | Behavior |
| --- | --- | --- |
| `POST /api/recipients/{recipientId}/enrollments` | Owning caretaker | Create enrollment; return `201` with ID, versioned QR payload, and expiry. |
| `GET /api/enrollments/{enrollmentId}` | Owning caretaker | Return state and, after claim, the matching code. Never return session or claimant secrets. |
| `POST /api/enrollments/claim` | Scanning client with QR secret | Bind enrollment to the client's claimant secret; return matching code, expiry, and poll interval. |
| `POST /api/enrollments/{enrollmentId}/approve` | Owning caretaker | Confirm the displayed matching code and activate the recipient's replacement session. |
| `DELETE /api/enrollments/{enrollmentId}` | Owning caretaker | Cancel enrollment; cannot undo an already active session. Use session revocation for that. |
| `POST /api/enrollments/{enrollmentId}/session` | Bound claimant | Poll for approval or collect the approved bearer session. |

State flow:

```text
issued -> claimed -> approved -> delivered
   |         |
   +---------+----> cancelled / expired
```

The approved credential-delivery window also expires. Its expiry does not revoke a session already activated at approval. After delivery, only the same claimant can retry collection within that short window. Enrollment expiry never reopens the QR for another claimant.

Detailed behavior:

1. Generate the QR secret with Web Crypto: 32 random bytes encoded as base64url. Store its hash. Return a versioned application payload containing only enrollment identification and the secret. No token-bearing HTTP query string is needed.
2. The mobile client generates and securely retains its own random claimant secret before sending the claim. This lets it repeat the same request if the response is lost.
3. Claim the QR with a conditional database write. The first claimant wins. Repeating that claimant's request returns the same outcome; a different claimant cannot replace it.
4. Generate the short matching code on the server and associate it with that claim. It is a visual confirmation value, never an authentication credential. Caretaker approval submits the expected code to catch stale screens.
5. Before approval, the new device has no task access. The old device retains access during an attempted replacement.
6. Approval activates exactly one replacement session and invalidates the old one as a single authoritative state change. Any session created during preparation must remain unusable until activation. Repeated approval cannot create more active sessions or reactivate an older enrollment.
7. Only the bound claimant can collect the session. Pending collection returns `202` with state and polling guidance; success returns `200` with token, token type, expiry, and minimal recipient identity. Deliver credentials in a response body with `Cache-Control: no-store`.
8. A dropped success response permits redelivery of the same approved session to that claimant within the delivery window. If the window has closed, start new enrollment for the same recipient.

Use conditional writes and D1 batches for application state. A conditional update that affects zero rows does not itself fail a batch: subsequent statements must be guarded by the winning claim or transaction assertions. Do not use an in-memory lock, a read-then-write check, or assume Better Auth calls are one transaction. The active-session reference keeps partial auth operations from granting access.

Starting defaults, to be named constants and documented rather than presented as product settings: 10 minutes to claim/approve, 5 minutes to collect after approval, and a 3-second polling interval. Keep the existing session lifetime initially; Phase 1 verifies renewal and token delivery. An expired session requires caretaker-assisted enrollment again.

Acceptance: simultaneous claims have one winner, stale approval fails, same-client retries recover, and replacement invalidates the old session without losing task assignments.

## 8. Phase 6 — Harden failures and publish the client contract

- Apply existing rate limits and add bounded enrollment-specific limits for issue/claim/poll attempts. Combine trusted-IP limits with enrollment/claimant limits where applicable. Limit failure attempts as well as successful operations.
- Preserve browser origin and CSRF protections for caretaker approval. Add mobile bearer support without broadly relaxing trusted origins.
- Validate payload version, secret lengths, IDs, display-name lengths, body sizes, and legal transitions before expensive work.
- Return stable problem types: invalid request, unauthorized, forbidden, not found/invalid enrollment, expired enrollment, enrollment conflict, rate limited, and internal failure. Do not reveal recipient details to invalid claimants.
- Audit issue, claim, approval, cancellation, revocation, and recipient deletion using internal record IDs and existing structured logging. Never log QR secrets, claimant secrets, matching codes, auth headers, session tokens, display names, or full request bodies.
- Expiry checks provide security without a scheduled job. Add bounded cleanup of expired enrollment data and unused prepared sessions; it must not remove active sessions or profiles with assignments.
- Add cookie and bearer security schemes to OpenAPI, including explicit pre-auth claim requirements, polling responses, retry semantics, and error examples.
- Regenerate `apps/api/openapi.json` and `packages/api-client/src/generated.ts` using `bun run api:generate`.
- Verify that the shared client can provide bearer headers; extend its existing configuration only if required. OpenAPI remains usable by a future native Swift or Kotlin client.
- Document future client duties: decode QR data, validate payload version, retain claimant secret across retries, display the matching code, poll with backoff, store the bearer token in platform secure storage, and clear private data after access is revoked.

## 9. Verification and delivery order

Implement every behavioral change using the `tdd` skill, in vertical slices:

1. Write one failing test at an agreed public interface and run it to verify the expected failure.
2. Implement only enough behavior through `routes → controller → service → D1` to make that test pass.
3. Run the test and relevant regression checks, then choose the next behavior based on what the completed slice revealed.

The agreed test seams are the real HTTP interface and the public service interfaces. HTTP tests exercise the full data flow against Miniflare D1. Service tests verify domain behavior through service results, not private methods or database queries used as assertion shortcuts. Confirm any additional seam before writing tests at it.

Do not write all tests before implementing, or implement the whole feature before writing tests. Do not mock controllers or services to test their own interactions. Mocks are limited to external dependencies such as the clock, logging output, and storage failures; use real D1 for normal persistence and transaction checks. Keep structural refactoring in the review stage, separate from the red → green implementation cycle.

Use the existing Bun tests and Miniflare D1 setup. Exercise the module interface and real HTTP requests; avoid tests that only mock permission or transaction behavior.

Required cases:

1. Existing caretaker login, tasks, categories, and guest AI behavior still work.
2. Recipient creation is caretaker-scoped and role fields cannot be forged.
3. Shared assignment, selective visibility, root-only validation, cross-caretaker denial, and assignment removal work.
4. Recipient deletion is caretaker-scoped, revokes access, removes dependent recipient data and the synthetic auth identity, preserves task trees, and frees a recipient-limit slot.
5. Every recipient write route is denied, including direct calls to existing routes and relevant auth mutation routes.
6. QR expiry, cancellation, concurrent claims, matching-code mismatch, stale approval, and different-claimant replay fail safely.
7. Lost claim/approval/collection responses recover without duplicate identities or active sessions.
8. Replacement, explicit revocation, disabling, assignment removal, and recipient deletion affect the next request; an old enrollment cannot restore access.
9. Failures between auth creation and application-state activation leave no usable unauthorized session.
10. Errors and logs contain no credentials or unrelated recipient/task data.
11. Migrations preserve seeded existing data; generated contracts match actual responses.

Run the backend test suite, repository formatting/lint checks, relevant TypeScript checks, the Worker dry-run build, and `bun run api:check`. Live AI calls are unnecessary for this feature.

Deliver in this order: authentication integration check; migration and permission enforcement; recipient/assignment operations; enrollment and recovery; generated contracts and full regression checks. Do not expose recipient provisioning before permission enforcement is in place.

Before a later production release, validate the migration against a staging copy, take a D1 recovery checkpoint, apply the additive migration, and deploy the compatible backend. An older backend that treats every authenticated user as a caretaker is not a safe rollback once recipient sessions exist. Disable recipient access and revoke recipient sessions before any such rollback, or roll forward with a fix.

At implementation time, update `CONTEXT.md` with the accepted recipient, caretaker, assignment, and enrollment terms using the domain-modeling workflow. Record the security model and migration implications in a focused ADR.

Done means the full flow passes through real HTTP requests with D1, old devices lose access, deleted recipients and their private data are gone, recipient deletion frees capacity without deleting task trees, recipients see only assigned task trees, and the caretaker web client can manage recipients and enrollment. No recipient-device UI, deployment, completion tracking, caretaker transfer, or general-purpose organization system is included in this implementation.

## Reference documentation

These describe supported library/platform mechanisms; the enrollment state machine and permission model above are project design choices. Verify behavior against the locked dependency version during Phase 1.

- [Better Auth Bearer plugin](https://better-auth.com/docs/plugins/bearer)
- [Better Auth custom plugins](https://better-auth.com/docs/concepts/plugins)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Cloudflare D1 batches and transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
