export const openApiConfig = {
  openapi: '3.0.3' as const,
  info: {
    title: 'Helping Hand API',
    version: '0.1.0',
  },
  servers: [{ url: '/', description: 'Current origin' }],
  tags: [{ name: 'Tasks' }],
}
