import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(() => 'evt-sentry-mock-id')
}));

import * as Sentry from '@sentry/node';
import { createMonoPulseApp } from '../src/server/app.ts';

describe('Structured Error Tracking & Sentry Integration (Rec 06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards unhandled Express route exceptions to Sentry.captureException when SENTRY_DSN is configured', async () => {
    const prevDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';

    try {
      const app = createMonoPulseApp();
      const res = await request(app).get('/api/health/error-probe');
      expect(res.status).toBe(500);
      expect(res.body.status).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error).toContain('Simulated unhandled service exception');
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    } finally {
      if (prevDsn === undefined) {
        delete process.env.SENTRY_DSN;
      } else {
        process.env.SENTRY_DSN = prevDsn;
      }
    }
  });

  it('gracefully logs via pino without calling Sentry.captureException when SENTRY_DSN is unset', async () => {
    const prevDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;

    try {
      const app = createMonoPulseApp();
      const res = await request(app).get('/api/health/error-probe');
      expect(res.status).toBe(500);
      expect(res.body.status).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error).toContain('Simulated unhandled service exception');
      expect(Sentry.captureException).not.toHaveBeenCalled();
    } finally {
      if (prevDsn !== undefined) {
        process.env.SENTRY_DSN = prevDsn;
      }
    }
  });
});
