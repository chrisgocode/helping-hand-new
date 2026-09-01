# OpenAPI generation and shared-client plan

## Objective

Create one machine-readable HTTP contract from the schemas that already validate
Helping Hand requests and responses. Generate a small, typed client from that
contract for the web app and any TypeScript mobile app, while keeping the same
runtime request path:

```text
HTTP
 ↓
route declaration
 ↓
OpenAPI/Zod validation
 ↓
controller
 ↓
service
 ↓
D1 or TaskAi
```

The OpenAPI document is the language-neutral seam. TypeScript web and React
Native clients use the shared `@helping-hand/api-client` adapter; a native Swift
or Kotlin app can later generate its own adapter from the same document.

## Non-goals

- Do not generate or wrap Better Auth endpoints. Better Auth keeps its own client.
- Do not build Swagger UI or Scalar yet. `/openapi.json` is sufficient.
- Do not add HTTP versioning as part of this migration. Decide that before the
  first independently released mobile client.
- Do not add handwritten methods for every endpoint on top of `openapi-fetch`.
- Do not add runtime response validation in clients yet. The Worker validates
  inputs, its tests verify outputs, and TypeScript checks client use.
- Do not expose D1 rows, OpenRouter responses, or internal error details.

## Decisions

### Contract source

Keep reusable runtime schemas in `@helping-hand/schemas`. The Worker adds HTTP
metadata, parameters, response status codes, descriptions, and security metadata.
Do not maintain a separate handwritten YAML contract.

This preserves locality:

- `packages/schemas` owns task shapes and Problem Details.
- `apps/api/src/schemas` owns request-location and HTTP contract definitions.
- `apps/api/src/routes` registers middleware, validation, and controllers.
- `packages/api-client` owns generated transport types and the fetch adapter.

### OpenAPI implementation

Use `@hono/zod-openapi`. Its `OpenAPIHono` implementation registers Zod-backed
routes, validates request values, exposes `c.req.valid()`, and generates an
OpenAPI document. Its route `middleware` runs before generated validators, so the
existing AI rate-limit-before-validation behavior can remain intact.

Use OpenAPI `3.0.3` initially. Helping Hand's task schemas are recursive, and the
3.0 generator has the more established recursive-reference path in this library.
OpenAPI 3.1 does not provide a needed feature for the current contract.

### Generated TypeScript client

Use:

- `openapi-typescript` as a development dependency to generate `paths` and
  component types.
- `openapi-fetch` as the only runtime dependency of `@helping-hand/api-client`.

The handwritten client interface should remain one factory:

```ts
createApiClient({ baseUrl, fetch? })
```

It configures `credentials: 'include'` for browser sessions. The optional `fetch`
supports native/mobile fetch implementations and tests without introducing a
custom transport interface.

### Generated files

Commit both generated artifacts:

```text
apps/api/openapi.json
packages/api-client/src/generated.ts
```

Consumers can build without first importing or compiling the Worker. CI detects
drift by regenerating both files and requiring a clean diff. Neither generated
file is hand-edited.

### Public errors

Finish the existing Problem Details migration before freezing the first OpenAPI
document. Validation, authentication, task, rate-limit, and unexpected errors
should use `application/problem+json`, not a mixture of Problem Details and
`{ "error": string }`.

This is directly useful now: otherwise the generated client permanently exposes
two unrelated error interfaces and every web/mobile caller needs branching logic.
Keep existing status codes unchanged.

Suggested retryability:

| Failure | Status | Retryable |
| --- | ---: | ---: |
| Validation | 400 | No |
| Authentication required | 401 | No |
| Task not found | 404 | No |
| Revision conflict | 409 | No; reload before resubmitting |
| Helping Hand rate limit | 429 | Yes |
| Invalid AI response | 502 | Yes |
| AI unavailable | 503 | Yes |
| AI timeout | 504 | Yes |
| Internal/configuration failure | 500 | No |

## Target directory layout

```text
apps/api/
├── openapi.json                         # generated
└── src/
    ├── app.ts                           # OpenAPIHono root + document route
    ├── openapi.ts                       # document metadata/configuration
    ├── controllers/
    │   └── task.controller.ts
    ├── routes/
    │   └── task.routes.ts              # OpenAPIHono registration
    ├── schemas/
    │   └── task.schema.ts              # route configs + HTTP schemas
    └── scripts/
        └── generate-openapi.ts          # deterministic artifact writer

packages/api-client/
├── package.json
├── tsconfig.json
└── src/
    ├── generated.ts                     # generated
    ├── client.ts                        # handwritten factory
    └── index.ts
```

No new `contracts` directory is needed. The existing `schemas` directory remains
the validation/HTTP-contract module, preserving the project's organization.

## Endpoint inventory

Give every operation a stable `operationId`; native generators and documentation
use it even though `openapi-fetch` primarily keys calls by method and path.

| Method and path | Operation ID | Success | Authentication |
| --- | --- | --- | --- |
| `GET /api/tasks` | `getTaskTrees` | `200 TaskTree[]` | Required |
| `PUT /api/tasks/{rootId}` | `saveTaskTree` | `200 TaskTree` | Required |
| `DELETE /api/tasks/{rootId}` | `deleteTaskTree` | `204` | Required |
| `POST /api/tasks/proposals/breakdown` | `proposeTaskBreakdown` | `200 TaskBreakdownProposal` | Optional |
| `POST /api/tasks/proposals/durations` | `proposeTaskDurations` | `200 TaskDurationProposal` | Optional |
| `POST /api/tasks/proposals/order` | `proposeTaskOrder` | `200 OrderOptimizationProposal` | Optional |

Every operation must also declare the actual error statuses reachable through
validation, middleware, controllers, and the global error handler. Do not use a
single undocumented `default` response to hide known behavior.

The three proposal routes remain guest-accessible. When the draft has a saved
revision, their existing application rule still requires an authenticated owner.
Document that invariant in each operation description.

## Implementation phases

### Phase 0: Prove recursive-schema compatibility

Before migrating routes, build a small temporary contract using the existing
`taskNodeSchema` and `taskTreeDraftSchema`:

1. Install a pinned compatible `@hono/zod-openapi` version in `apps/api`.
2. Register `TaskNode` as a named schema from the Worker without changing
   `packages/schemas` to depend on Hono.
3. Generate a 3.0.3 document containing a recursive task-tree response.
4. Run `openapi-typescript` against it.
5. Compile a fixture that accesses descendants recursively.

Acceptance criteria:

- The document uses a reusable `$ref` for recursive task nodes instead of
  infinitely expanding or dropping `children`.
- Nullable `durationSeconds` remains `number | null`.
- `revision` differs correctly between `TaskTreeDraft` and saved `TaskTree`.
- Generated TypeScript compiles under the web app's strict TypeScript settings.

Delete the temporary fixture once these checks become permanent contract tests.
If the library cannot preserve recursion, stop and resolve that before converting
routes; do not duplicate the task schemas in the Worker.

### Phase 1: Complete reusable schemas and Problem Details

Move the remaining reusable request schemas from
`apps/api/src/schemas/task.schema.ts` into `packages/schemas/src/task.ts`:

- `deleteTaskInputSchema`
- `taskProposalInputSchema`
- `breakdownProposalInputSchema`
- `taskDetailSchema`

Export their inferred types from `@helping-hand/schemas`; remove the matching
handwritten types from `apps/api/src/types/task.ts`.

Add named response schemas where only inferred types currently exist:

- `taskTreeSchema`
- `taskTreeListSchema`
- existing breakdown, duration, and order proposal schemas
- `problemDetailsSchema`

Convert existing `{ error: string }` responses to the existing Problem Details
formatter. Add stable problem type URNs for validation, unauthorized, not found,
conflict, rate limited, and internal errors. Keep Better Auth's own response
formats outside this migration.

Acceptance criteria:

- Every `/api/tasks` response body has a Zod schema.
- Every non-2xx task response is `application/problem+json`.
- No provider message, task content, secret, or internal exception is returned.
- Existing route tests assert the new error contract and unchanged status codes.

### Phase 2: Define the OpenAPI document module

Create `apps/api/src/openapi.ts` with deterministic metadata:

- `openapi: 3.0.3`
- title: `Helping Hand API`
- a fixed contract version such as `0.1.0`
- server URL `/` so the artifact is environment-independent
- one `Tasks` tag
- a cookie-based session security scheme for authenticated task operations

Do not put deployment hostnames, secrets, model names, rate-limit identifiers, or
database details in the document.

Register named schema components so generated types are readable and recursive
references remain stable:

- `TaskNode`
- `TaskTreeDraft`
- `TaskTree`
- `TaskBreakdownProposal`
- `TaskDurationProposal`
- `OrderOptimizationProposal`
- `ProblemDetails`

### Phase 3: Replace custom task validation with OpenAPI routes

Migrate from the top down, because `OpenAPIHono` only merges definitions from
OpenAPI-aware child routers:

1. Change the root app in `app.ts` from `Hono<TaskRouteEnv>` to
   `OpenAPIHono<TaskRouteEnv>`.
2. Change `taskRoutes` to `OpenAPIHono<TaskRouteEnv>`.
3. Define each `createRoute` configuration in
   `apps/api/src/schemas/task.schema.ts`.
4. Register each configuration in `task.routes.ts` with its existing controller.
5. Put route-specific middleware in the route configuration in its current order.
6. Add one default validation hook that returns sanitized 400 Problem Details.

For JSON requests, declare `request.body.required: true`. This prevents a missing
`Content-Type` header from being interpreted as an empty validated object.

Controller changes:

- Read validated inputs with `c.req.valid('param')` and `c.req.valid('json')`.
- Continue translating HTTP/context values into application calls.
- Return explicit status codes, including explicit `200` values, so handler output
  is checked against the route contract.
- Remove `rootId`, `saveTaskInput`, `deleteTaskInput`, `taskProposalInput`, and
  `breakdownProposalInput` from Hono context variables after their old validation
  middleware is deleted.

Middleware order must remain observable and tested:

```text
global request ID/logger/auth resolution/regular rate limit
 ↓
route auth or AI rate limit
 ↓
OpenAPI request validation
 ↓
AI request logging where applicable
 ↓
controller
```

In particular, invalid guest AI requests must still consume/check the AI rate
limit before body validation, matching the current security behavior.

### Phase 4: Expose and generate the document

Register `GET /openapi.json` on the root `OpenAPIHono` app. Keep it outside
`/api/*` so it does not invoke session resolution or rate-limit bindings. The
document is public metadata and contains no secrets.

Create `apps/api/src/scripts/generate-openapi.ts` that:

1. Imports the configured app and document metadata.
2. Calls `getOpenAPIDocument()` directly without starting Wrangler or an HTTP
   listener.
3. Writes pretty, deterministic JSON with a trailing newline to
   `apps/api/openapi.json`.

Add scripts:

```text
apps/api: openapi:generate
root:     api:generate
```

The root command should first generate the document and then generate the shared
TypeScript client. It must not deploy a Worker, contact D1, or require secrets.

### Phase 5: Build `@helping-hand/api-client`

Initialize the existing `packages/api-client` directory as a private workspace
package.

Dependencies:

- runtime: `openapi-fetch`
- development: `openapi-typescript`, TypeScript

Generate `src/generated.ts` from `apps/api/openapi.json`. Add a header explaining
that the file is generated and must not be edited.

Implement only the client factory in `src/client.ts`:

- required `baseUrl`
- optional injected `fetch`
- `credentials: 'include'`
- generated `paths` type

Re-export the factory and generated transport types from `src/index.ts`. Do not
create `tasks.getAll()`, `tasks.save()`, or React hooks yet; `openapi-fetch` already
provides the needed typed interface.

Package acceptance test:

- Inject a fake `fetch` at the network seam.
- Verify the base URL, cookie credentials, JSON request, and path parameter for
  one representative call.
- Verify the returned typed error supports `ProblemDetails`.
- Do not mock internal client functions.

### Phase 6: Add drift checks

Add a check that regenerates both artifacts and fails when Git sees changes in:

```text
apps/api/openapi.json
packages/api-client/src/generated.ts
```

Run that check in CI, not the pre-commit hook. Generation can take longer and a
pre-commit mutation is surprising. The existing pre-commit Biome check will still
format/check handwritten source.

Also run:

- API tests
- API TypeScript check
- API Worker dry-run build
- API-client TypeScript check
- web TypeScript/build after it starts consuming the client

### Phase 7: Connect the first consumer

As a separate vertical slice, add `@helping-hand/api-client` to the web app and
use `GET /api/tasks` as the first real call. Configure the base URL from a Vite
environment variable and send session cookies.

Test through the client interface with an injected fetch or Mock Service Worker;
do not import the Worker app into web tests. Once web use is stable, the mobile
adapter can consume the same document.

## Test matrix

### Contract-generation tests

- Document version is `3.0.3`.
- All six task operations exist with stable operation IDs.
- Every path parameter uses OpenAPI `{rootId}` syntax.
- JSON request bodies are required.
- Recursive `TaskNode.children` resolves through a component reference.
- `durationSeconds` and draft `revision` remain nullable.
- Authenticated operations declare cookie security; proposal operations do not.
- `204` has no response body schema.
- Known non-2xx statuses reference `ProblemDetails` with
  `application/problem+json`.

### Runtime route tests

Keep the existing HTTP tests and add checks that OpenAPI migration does not alter:

- authentication requirements
- guest proposal access
- regular and AI rate-limit ordering
- input rejection
- request IDs
- Problem Details media types
- D1 persistence behavior
- AI failure normalization

### Generated-client checks

- `openapi-typescript` exits successfully.
- The generated file type-checks without `any` assertions.
- A compile-only fixture rejects an invalid task body and invalid path parameter.
- A representative request through injected fetch uses the expected URL and
  credentials.

Avoid snapshots of the entire OpenAPI document. They make intentional metadata
changes noisy. Assert the important contract invariants and use the committed
artifact drift check for full-document changes.

## Risks and mitigations

### Recursive Zod schema generation

This is the highest-risk item and is why Phase 0 comes first. Use named component
references and OpenAPI 3.0.3. Do not solve generator trouble by creating a second
handwritten task model.

### Plain Hono child routers losing metadata

Both root and task routers must be `OpenAPIHono`. Migrate top-down and add a test
that `/api/tasks` appears in the generated document.

### Middleware behavior changing during migration

Route middleware is declared explicitly and runtime tests verify ordering.
Do not rely on the OpenAPI document itself to prove middleware execution.

### Contract and implementation drift

Typed OpenAPI handlers check declared response shapes during compilation, runtime
route tests check behavior, and generated-artifact drift checks catch forgotten
regeneration.

### Better Auth coupling

Exclude `/api/auth/*` from the first Helping Hand document. The task client only
sends cookies. Revisit documenting Better Auth endpoints only if a non-Better-Auth
client actually needs that contract.

## Definition of done

- `/openapi.json` returns a valid OpenAPI 3.0.3 document locally.
- `apps/api/openapi.json` is generated offline with no secrets or network access.
- All six task operations and their known response statuses are documented.
- Recursive task trees generate correct reusable component types.
- All task-route request validation comes from the schemas used by OpenAPI.
- Runtime behavior and middleware ordering remain unchanged.
- All task errors use the documented Problem Details contract.
- `@helping-hand/api-client` generates and type-checks from the committed document.
- Regeneration produces no diff immediately after generation.
- API tests, TypeScript, Biome, Worker dry-run build, and API-client checks pass.

## Primary references

- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [`@hono/zod-openapi` README](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- [`@hono/zod-openapi` route registration implementation](https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts)
- [openapi-typescript and openapi-fetch](https://openapi-ts.dev/openapi-fetch/)
- [openapi-fetch interface](https://openapi-ts.dev/openapi-fetch/api)
