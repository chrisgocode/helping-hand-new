# API client

Typed fetch client shared by the web app and TypeScript mobile clients.

```ts
import { createApiClient } from '@helping-hand/api-client'

const api = createApiClient({ baseUrl: 'http://localhost:8787' })
const { data, error } = await api.GET('/api/tasks')
```

Run `bun run api:generate` from the repository root after changing an API route or schema.
Do not edit `src/generated.ts` directly.
