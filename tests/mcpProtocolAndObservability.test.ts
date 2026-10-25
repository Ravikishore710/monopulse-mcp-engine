import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMonoPulseApp } from '../src/server/app.ts';
import {
  resolveVerifiedCallerRole,
  signRoleBearerToken,
  verifyWebhookReplayWindow
} from '../src/server/cryptoSecurity.ts';
import { sanitizeAndTruncateMcpPayload } from '../src/server/mcpProtocolSpec.ts';
import {
  acquireEventApprovalLock,
  computeAndRecordWebhookFingerprint,
  releaseEventApprovalLock
} from '../src/server/sqliteEngine.ts';

describe('MCP Protocol Spec 2024-11-05, Observability, Replay Guard & Concurrency Locks', () => {
  const app = createMonoPulseApp();

  it('handles MCP initialize handshake, resources/list, resources/read, prompts/list, and prompts/get', async () => {
    const initRes = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 'init-1', method: 'initialize' });
    expect(initRes.status).toBe(200);
    expect(initRes.body.result.protocolVersion).toBe('2024-11-05');
    expect(initRes.body.result.capabilities.tools).toBeDefined();
    expect(initRes.body.result.capabilities.resources).toBeDefined();

    const resList = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 'r-1', method: 'resources/list' });
    expect(resList.status).toBe(200);
    expect(resList.body.result.resources.length).toBeGreaterThanOrEqual(3);

    const resRead = await request(app)
      .post('/api/mcp/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'r-2',
        method: 'resources/read',
        params: { uri: 'monopulse://schema/sqlite-tables' }
      });
    expect(resRead.status).toBe(200);
    expect(resRead.body.result.contents[0].mimeType).toBe('application/json');

    const promptsList = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 'p-1', method: 'prompts/list' });
    expect(promptsList.status).toBe(200);
    expect(promptsList.body.result.prompts.length).toBeGreaterThanOrEqual(2);

    const promptGet = await request(app)
      .post('/api/mcp/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'p-2',
        method: 'prompts/get',
        params: { name: 'incident-rca-synthesis', arguments: { service: 'checkout-ledger-svc' } }
      });
    expect(promptGet.status).toBe(200);
    expect(promptGet.body.result.messages[0].content.text).toContain('checkout-ledger-svc');
  });

  it('executes JSON-RPC 2.0 batch array requests in a single HTTP round-trip', async () => {
    const batchRes = await request(app)
      .post('/api/mcp/rpc')
      .send([
        { jsonrpc: '2.0', id: 'b-1', method: 'ping' },
        { jsonrpc: '2.0', id: 'b-2', method: 'resources/list' }
      ]);
    expect(batchRes.status).toBe(200);
    expect(Array.isArray(batchRes.body)).toBe(true);
    expect(batchRes.body).toHaveLength(2);
    expect(batchRes.body[0].result.ok).toBe(true);
  });

  it('scrubs sensitive Bearer/GitHub/Slack/AWS secrets and truncates oversized tool outputs', () => {
    const raw = {
      header: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      githubToken: 'ghp_1234567890abcdefghijklmnopqrstuvwx',
      awsKey: 'AKIAIOSFODNN7EXAMPLE'
    };
    const scrubbed = sanitizeAndTruncateMcpPayload(raw);
    expect(JSON.stringify(scrubbed)).toContain('[REDACTED_SECRET]');
    expect(JSON.stringify(scrubbed)).not.toContain('AKIAIOSFODNN7EXAMPLE');

    const huge = { text: 'x'.repeat(25000) };
    const truncated = sanitizeAndTruncateMcpPayload(huge, 1024) as unknown as Record<string, any>;
    expect(truncated._truncated).toBe(true);
  });

  it('serves Prometheus metrics (/api/metrics), W3C traceparent headers, and /api/health/live + /api/health/ready', async () => {
    const liveRes = await request(app).get('/api/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('alive');
    expect(liveRes.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const readyRes = await request(app).get('/api/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.sqliteEngine).toContain('SQLite');

    const metricsRes = await request(app).get('/api/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.text).toContain('monopulse_mcp_tool_calls_total');
    expect(metricsRes.text).toContain('monopulse_sqlite_table_rows');
  });

  it('verifies Bearer RBAC tokens, rejects expired webhook timestamps, deduplicates alert fingerprints, and enforces approval locks', async () => {
    const sreBearer = signRoleBearerToken('sre_admin');
    const resolved = resolveVerifiedCallerRole(`Bearer ${sreBearer}`, 'readonly_analyst');
    expect(resolved.role).toBe('sre_admin');
    expect(resolved.verifiedFromBearer).toBe(true);

    const forged = resolveVerifiedCallerRole('Bearer mp_role_v1.sre_admin.000000000000000000000000', 'sre_admin');
    expect(forged.role).toBe('readonly_analyst');
    expect(forged.verifiedFromBearer).toBe(false);

    const expiredTs = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookReplayWindow(String(expiredTs)).valid).toBe(false);

    const replayRejected = await request(app)
      .post('/api/webhooks/ingest')
      .set('X-MonoPulse-Timestamp', String(expiredTs))
      .send({
        source: 'slack.incident.webhook',
        service: 'checkout-ledger-svc',
        channelOrTicket: '#inc-prod-alerts',
        payloadSummary: 'Replay attack test payload'
      });
    expect(replayRejected.status).toBe(401);
    expect(replayRejected.body.status).toBe('WEBHOOK_TIMESTAMP_EXPIRED');

    const fp1 = computeAndRecordWebhookFingerprint({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      payloadSummary: 'Duplicate alert burst #1'
    });
    const fp2 = computeAndRecordWebhookFingerprint({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      payloadSummary: 'Duplicate alert burst #1'
    });
    expect(fp1.deduplicated).toBe(false);
    expect(fp2.deduplicated).toBe(true);
    expect(fp2.occurrenceCount).toBe(2);

    expect(acquireEventApprovalLock('evt-lock-test-1', 'sre_admin')).toBe(true);
    expect(acquireEventApprovalLock('evt-lock-test-1', 'sre_admin')).toBe(false);
    releaseEventApprovalLock('evt-lock-test-1');
    expect(acquireEventApprovalLock('evt-lock-test-1', 'sre_admin')).toBe(true);
  });
});
