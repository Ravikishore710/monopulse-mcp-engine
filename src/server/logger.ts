import pino from 'pino';

export const logger = pino({
  name: 'monopulse-mcp-engine',
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.secret',
      '*.token',
      '*.apiKey',
      '*.approvalToken'
    ],
    censor: '[REDACTED]'
  },
  base: {
    service: 'monopulse-core',
    version: '1.2.0'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

export function createRequestLogContext(route: string, correlationId?: string) {
  return logger.child({
    reqId: correlationId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    route
  });
}
