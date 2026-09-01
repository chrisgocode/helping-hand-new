import app from '../app'
import { openApiConfig } from '../openapi'

const output = new URL('../../openapi.json', import.meta.url)
const document = app.getOpenAPIDocument(openApiConfig)

await Bun.write(output, `${JSON.stringify(document, null, 2)}\n`)
