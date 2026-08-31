import { Hono } from 'hono'

const app = new Hono<{
  Bindings: Env
}>()

app.get('/', (c) => c.json({ message: 'Helping Hand API' }))


export default app
