import pino from 'pino';

export const logger = pino({
  name: 'monopulse-mcp-engine',
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'monopulse-core',
    version: '1.0.0'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

export function createRequestLogContext(route: string, reqId?: string) {
  const correlationId = reqId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return logger.child({ reqId: correlationId, route });
}
