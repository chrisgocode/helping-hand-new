# Rate limiting and production logging

## Recommendation

Use Cloudflare's native Workers features and keep the first version small:

1. Give registered members higher per-user limits.
2. Give guests a similar allowance for ordinary public endpoints but a much smaller shared allowance for AI proposals.
3. Enable Workers Logs and emit structured events only when they add information beyond Cloudflare's invocation log.
4. Keep authentication abuse protection separate because it runs before a verified user ID exists.

Use Pino for application logs. This does not require a Pino transport, a Hono rate-limit package, Durable Objects, or D1-backed counters.

## Rate-limit policy

| Caller | Scope | Initial limit | Key |
| --- | --- | ---: | --- |
| Registered member | Regular API | 600 requests per 60 seconds | authenticated user ID |
| Guest | Regular public API | 60 requests per 60 seconds | connecting IP |
| Registered member | AI proposals | 60 requests per 60 seconds | authenticated user ID |
| Guest | AI proposals | 5 requests per 60 seconds | connecting IP |

Here, a "smaller" guest AI limit means fewer allowed requests in the same 60-second window, not a shorter window. The AI limit should be shared by breakdown, duration estimation, and ordering. If each action had a separate allowance, a caller could consume three times the intended AI budget. These values are starting points, not product requirements; tune them from actual 429 rates and normal usage.

Use four bindings with distinct namespace IDs so tiers and traffic classes cannot consume one another's allowance. A bare user ID or IP is sufficient as the key because the binding namespace already identifies the tier and traffic class. User IDs are preferred whenever a session exists; IP limiting is only the guest fallback and may group people on shared networks.

Apply the checks in this order:

```text
HTTP
  -> route
  -> resolve required or optional identity
  -> select member or guest rate limit
  -> validation
  -> controller
  -> service
  -> D1 or OpenRouter
```

This preserves the project's route/validation/controller/service structure while ensuring rejected AI requests never reach validation, controllers, or OpenRouter. A rejection should return HTTP `429` and `Retry-After: 60` with the API's normal JSON error shape.

The current task router applies `requireAuth` to every route. Therefore, today, guests cannot reach either ordinary task operations or AI proposals. Supporting guest AI proposals requires a deliberate route split:

- Persisted task reads, saves, and deletes remain authenticated because they access user-owned D1 data.
- AI proposal routes may use optional authentication because they transform a client-held draft without persisting it.
- Any future ordinary public endpoint may use the guest regular limit; this policy does not make an authenticated endpoint public by itself.

Keep this authorization decision visible in the routes. The rate-limit module's small interface should receive a policy (`regular` or `ai`) and hide tier selection, binding selection, key selection, `429` formatting, and logging. Routes should not know binding names or construct rate-limit keys.

Cloudflare's binding is a good abuse-control mechanism because it is fast and supports arbitrary keys such as user IDs. It is deliberately permissive, eventually consistent, and local to a Cloudflare location, however. It must not be treated as an exact quota, billing counter, or guaranteed OpenRouter spending cap. Provider-side spending controls remain the hard backstop. See [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

The installed Wrangler version satisfies the binding's minimum requirement. After adding bindings, regenerate the Worker environment types with the existing `cf-typegen` script.

## Authentication boundary

The application limits above do not replace protection for `/api/auth/*`; authentication endpoints run before a verified user ID exists.

Better Auth enables a built-in limiter in production and has stricter defaults for sensitive endpoints, but its default in-memory storage is not reliable across serverless Worker isolates. It also recommends Cloudflare's trusted `cf-connecting-ip` header when IP-based limiting is used. See [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit).

For the first public deployment:

- Keep Better Auth's production limiter enabled and configure Cloudflare's connecting-IP header correctly.
- Add one coarse Cloudflare WAF rate-limiting rule for `/api/auth/*` if the deployed Cloudflare plan and domain setup support it. WAF rules run before the Worker and are the appropriate outer defense for unauthenticated floods and login brute force. See [Cloudflare WAF rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/).

Do not add D1 rate-limit writes or Durable Objects now. Consider a sharded Durable Object or Better Auth custom storage only if testing shows that the basic auth protection is inadequate or a globally stricter quota becomes a real requirement.

## Production logging

Enable Workers Observability explicitly in `wrangler.jsonc`. Start with a head sampling rate of `1` while traffic is low, then reduce it only when log volume justifies the loss of visibility. Sampling is request-wide, so an unsampled request's errors and custom logs are also absent.

Workers already emits one invocation log per request. Use a shared Pino logger with request-scoped children for custom application events, but do not add Hono's string-based request logger in production; it would largely duplicate method, URL, status, and duration while increasing log volume. Workers Logs indexes structured object fields, so custom events should use objects rather than formatted strings. See [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) and [Hono logger middleware](https://hono.dev/docs/middleware/builtin/logger).

Add custom structured events only for:

- `rate_limited`: policy (`regular` or `ai`), tier (`member` or `guest`), route template, request ID, and retry interval.
- `ai_request_completed`: AI operation, model, duration, and success or normalized failure category.
- `unhandled_error`: request ID, route template, and normalized internal error code.

Prefer Cloudflare's Ray ID for request correlation when it is present; otherwise generate a UUID. Return the same request ID in an `X-Request-Id` response header so a client report can be matched to logs.

Do not log:

- task titles, task trees, descriptions, AI prompts, or AI output;
- request or response bodies;
- authorization, cookie, or session headers;
- passwords, email addresses, API keys, or provider tokens;
- raw OpenRouter error bodies or exception causes that may contain user content;
- full URLs or query strings.

Task content may reveal disability, health, or daily-living information, so content-free operational logs should be the default. Route templates such as `/api/tasks/:rootId` are safer and easier to aggregate than raw paths.

As of the current Workers documentation, Workers Logs retains data for three days on the Free plan and seven days on the Paid plan. The Free plan includes 200,000 events per day; the Paid plan includes 20 million per month before usage charges. These limits reinforce emitting only useful custom events rather than logging every application step. See [Workers Logs limits and pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#limits).

## Proposed implementation shape

Keep the implementation close to the existing request pipeline:

```text
src/
  middleware/
    rate-limit.ts       # small Hono middleware around Worker bindings
    request-context.ts  # correlation ID and structured completion/error context
  routes/
    task.routes.ts      # attaches task and AI policies to existing routes
```

`request-context.ts` may be unnecessary if the correlation and error logging fit cleanly in `app.ts`; prefer the fewer-file option during implementation. The rate-limit middleware should remain transport-level infrastructure and should not enter `TaskService` or `TaskAi`.

Configuration contains four `ratelimits` bindings and an explicit `observability` block. Pino is the only logging dependency; Workers Logs remains the destination, so no transport is needed.

## Verification plan

1. Unit-test the middleware with member and guest identities plus successful and rejected binding responses, including `429`, JSON error shape, and `Retry-After`.
2. Verify the four tier/traffic combinations use separate bindings and that all three AI operations share the appropriate member or guest key space.
3. Verify persisted task routes remain `401` for guests, while deliberately public routes select the guest policy and never consume member counters.
4. Run locally with Wrangler and confirm repeated requests eventually receive `429`; do not assert an exact accepted count because the binding is intentionally permissive.
5. Deploy to a non-production Worker, confirm structured fields are searchable in Workers Logs, and audit captured records for task/auth content before production traffic.

## Deferred until there is evidence

- Analytics Engine dashboards for rate-limit metrics.
- OpenTelemetry export, Logpush, Tail Workers, or a third-party logging vendor.
- Durable Objects for globally stricter quotas.
- Additional subscription tiers or per-operation AI quotas.
- Persistent Better Auth rate-limit storage beyond the coarse WAF and built-in protection.
