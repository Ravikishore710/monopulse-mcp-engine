import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

describe('Express API Routes, Health Probe, Auth & Full Endpoint Suite', () => {
  const app = createMonoPulseApp();

  it('GET /api/health, /api/health/live, and /api/health/ready return 200 OK with readiness telemetry', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mcpServersReady).toBe(6);
    expect(res.body.mcpToolsReady).toBe(28);

    const liveRes = await request(app).get('/api/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('alive');

    const readyRes = await request(app).get('/api/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.status).toBe('ok');
  });

  it('GET /api/system/state, /api/openapi.json, and /api/metrics return operational snapshots and schemas', async () => {
    const res = await request(app).get('/api/system/state');
    expect(res.status).toBe(200);
    expect(res.body.mcpServers).toHaveLength(6);
    expect(res.body.mcpTools).toHaveLength(28);
    expect(res.body.hashChainIntegrity.valid).toBe(true);

    const openApi = await request(app).get('/api/openapi.json');
    expect(openApi.status).toBe(200);
    expect(openApi.body.openapi).toBe('3.1.0');
    expect(openApi.body.paths['/api/mcp/rpc']).toBeDefined();

    const metricsRes = await request(app).get('/api/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.text).toContain('monopulse_http_requests_total');
    expect(metricsRes.text).toContain('monopulse_mcp_tool_duration_ms_bucket');
  });

  it('POST /api/auth/token issues signed Bearer token and POST /api/mcp/rpc enforces Bearer RBAC & Zod validation', async () => {
    const tokenRes = await request(app).post('/api/auth/token').send({ role: 'sre_admin' });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.bearerToken).toMatch(/^mp_role_v1\.sre_admin\./);

    const rpcRes = await request(app)
      .post('/api/mcp/rpc')
      .set('Authorization', `Bearer ${tokenRes.body.bearerToken}`)
      .send({
        jsonrpc: '2.0',
        id: 'api-test-1',
        method: 'tools/call',
        params: {
          name: 'sql_inspect_table_schema',
          arguments: { table_name: 'deployments' }
        }
      });
    expect(rpcRes.status).toBe(200);
    expect(rpcRes.body.status).toBe('SUCCESS');

    const badRpc = await request(app).post('/api/mcp/rpc').send({
      jsonrpc: '2.0',
      method: 'invalid/unknown_method'
    });
    expect(badRpc.status).toBe(400);
    expect(badRpc.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /api/webhooks/ingest returns 400 VALIDATION_ERROR on invalid Zod payload and 200 on valid ingest', async () => {
    const res = await request(app).post('/api/webhooks/ingest').send({
      source: 'invalid.source.type',
      service: 'unknown-service',
      channelOrTicket: '',
      payloadSummary: 'bad'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);

    const validRes = await request(app).post('/api/webhooks/ingest').send({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'API suite test: PgBouncer saturation > 98% on dep-9042'
    });
    expect(validRes.status).toBe(200);
    expect(validRes.body.status).toBe('PRECOMPUTED_AND_STAGED');
    expect(validRes.body.event.autonomousReadOnlyTrace.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/memory/search and POST /api/kaggle/distill validate payloads and execute hybrid search & distillation', async () => {
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

    const distillRes = await request(app).post('/api/kaggle/distill').send({
      eventId: 'evt-ambient-901'
    });
    expect(distillRes.status).toBe(200);
    expect(distillRes.body.job.status).toBe('COMPLETED');
    expect(distillRes.body.newPlaybook.id).toMatch(/^PB-/);
  });

  it('POST /api/cli/exec and GET /api/security/sqlite-backup execute cleanly', async () => {
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

    const backupRes = await request(app).get('/api/security/sqlite-backup');
    expect(backupRes.status).toBe(200);
    expect(backupRes.body.hashChainIntegrity.valid).toBe(true);
    expect(Array.isArray(backupRes.body.deployments)).toBe(true);
  });
});
