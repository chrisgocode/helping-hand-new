import pino from 'pino'

export const logger = pino({ base: null, level: 'info', browser: { asObject: true } })
