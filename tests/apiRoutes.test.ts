import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

describe('Express API Routes, Health Probe & Zod Input Validation', () => {
  const app = createMonoPulseApp();

  it('GET /api/health returns 200 OK with readiness telemetry', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mcpServersReady).toBe(6);
    expect(res.body.mcpToolsReady).toBe(28);
  });

  it('GET /api/system/state returns full operational state snapshot', async () => {
    const res = await request(app).get('/api/system/state');
    expect(res.status).toBe(200);
    expect(res.body.mcpServers).toHaveLength(6);
    expect(res.body.mcpTools).toHaveLength(28);
  });

  it('POST /api/webhooks/ingest returns 400 VALIDATION_ERROR on invalid Zod payload', async () => {
    const res = await request(app).post('/api/webhooks/ingest').send({
      source: 'invalid.source.type',
      service: 'unknown-service',
      channelOrTicket: '',
      payloadSummary: 'bad'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('POST /api/memory/search validates query and returns top-k pgvector matches', async () => {
    const badRes = await request(app).post('/api/memory/search').send({
      query: '',
      topK: 99
    });
    expect(badRes.status).toBe(400);
    expect(badRes.body.error).toBe('VALIDATION_ERROR');

    const okRes = await request(app).post('/api/memory/search').send({
      query: 'PgBouncer connection pool exhaustion on checkout-ledger-svc',
      topK: 2
    });
    expect(okRes.status).toBe(200);
    expect(okRes.body.matches).toHaveLength(2);
  });

  it('POST /api/cli/exec executes CLI commands and validates input with Zod', async () => {
    const badRes = await request(app).post('/api/cli/exec').send({
      command: ''
    });
    expect(badRes.status).toBe(400);

    const okRes = await request(app).post('/api/cli/exec').send({
      command: 'monopulse mcp list',
      callerRole: 'sre_admin'
    });
    expect(okRes.status).toBe(200);
    expect(okRes.body.exitCode).toBe(0);
    expect(okRes.body.output).toContain('sql-ops-mcp');
  });
});
