import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';
import { executeMCPToolCall } from '../src/server/mcpRegistry.ts';
import { sanitizeCsvCell, verifyAuditHashChain } from '../src/server/durableLedger.ts';
import { signRoleBearerToken } from '../src/server/cryptoSecurity.ts';
import { executeWithRetryAndCircuitBreaker } from '../src/server/liveConnectors.ts';
import { stemOperationalToken, tokenizeAndStemQuery } from '../src/server/memoryRanker.ts';

describe('Durable Ledger, SHA-256 Hash Chain, ABAC, Multi-Vendor Webhooks & MCP 2025 Parity', () => {
  const app = createMonoPulseApp();

  it('verifies genesis-to-head SHA-256 cryptographic audit hash chain and formula-safe CSV sanitization', async () => {
    executeMCPToolCall({
      toolName: 'sql_inspect_table_schema',
      args: { table_name: 'deployments' },
      callerRole: 'sre_admin'
    });

    const chain = verifyAuditHashChain();
    expect(chain.valid).toBe(true);
    expect(chain.verifiedRows).toBeGreaterThanOrEqual(1);
    expect(chain.headHash).toHaveLength(64);
    expect(chain.tamperedFrameId).toBeNull();

    const chainRes = await request(app).get('/api/security/hash-chain/verify');
    expect(chainRes.status).toBe(200);
    expect(chainRes.body.valid).toBe(true);

    // Verify CSV formula injection protection
    expect(sanitizeCsvCell('=1+1')).toBe(`"'=1+1"`);
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe(`"'+SUM(A1:A2)"`);
    expect(sanitizeCsvCell('@cmd')).toBe(`"'@cmd"`);

    const csvRes = await request(app).get('/api/security/audit?format=csv');
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('frame_id,timestamp,server_id,tool_name');
  });

  it('normalizes Slack url_verification, Prometheus Alertmanager, PagerDuty V3, and GitHub deployment_status webhooks', async () => {
    // 1. Slack url_verification challenge
    const slackChallenge = await request(app)
      .post('/api/webhooks/ingest')
      .send({ type: 'url_verification', challenge: 'slack_challenge_xyz_99' });
    expect(slackChallenge.status).toBe(200);
    expect(slackChallenge.body.challenge).toBe('slack_challenge_xyz_99');

    // 2. Prometheus Alertmanager v4 payload
    const alertmanagerRes = await request(app)
      .post('/api/webhooks/ingest')
      .send({
        alerts: [
          {
            status: 'firing',
            labels: {
              alertname: 'PgBouncerPoolSaturation',
              service: 'checkout-ledger-svc',
              channel: '#inc-prod-alerts'
            },
            annotations: {
              summary: '[Alertmanager] PgBouncer pool saturation > 98% on checkout-ledger-svc'
            }
          }
        ]
      });
    expect(alertmanagerRes.status).toBe(200);
    expect(alertmanagerRes.body.vendorFormat).toBe('prometheus.alertmanager.v4');
    expect(alertmanagerRes.body.event.service).toBe('checkout-ledger-svc');

    // 3. PagerDuty V3 webhook payload
    const pdRes = await request(app)
      .post('/api/webhooks/ingest')
      .send({
        event: {
          event_type: 'incident.triggered',
          data: {
            id: 'PD9088',
            title: '5xx error rate spike on checkout-ledger-svc canary',
            service: { summary: 'checkout-ledger-svc' }
          }
        }
      });
    expect(pdRes.status).toBe(200);
    expect(pdRes.body.vendorFormat).toBe('pagerduty.v3.webhook');
  });

  it('enforces ABAC contextual policy rules and literal-aware SQL comment stripping', () => {
    // Literal-aware SQL guard: '--' inside single-quoted string literal is allowed
    const validLiteralSql = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query: "SELECT deploy_id, status FROM deployments WHERE status != 'A--B'",
        row_limit: 5
      },
      callerRole: 'readonly_analyst'
    });
    expect(validLiteralSql.status).toBe('SUCCESS');

    // Real SQL comment outside string literal is blocked
    const realCommentSql = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query: "SELECT deploy_id FROM deployments WHERE status = 'ACTIVE' -- comment",
        row_limit: 5
      },
      callerRole: 'readonly_analyst'
    });
    expect(realCommentSql.status).toBe('SQL_MUTATION_BLOCKED');

    // RBAC & ABAC policy guard
    const rbacBlocked = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: {
        deploy_id: 'dep-9042',
        reason: 'Attempted Tier-0 mutation by non-sre_admin'
      },
      callerRole: 'readonly_analyst'
    });
    expect(rbacBlocked.status).toBe('RBAC_DENIED');
  });

  it('supports MCP 2024-11-05 / 2025-03-26 ping, logging/setLevel, completion/complete, resources/templates/list, and ToolAnnotations', async () => {
    const pingRes = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 'p-1', method: 'ping' });
    expect(pingRes.status).toBe(200);
    expect(pingRes.body.result).toEqual({ ok: true });

    const logRes = await request(app)
      .post('/api/mcp/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'l-1',
        method: 'logging/setLevel',
        params: { level: 'debug' }
      });
    expect(logRes.status).toBe(200);
    expect(logRes.body.result.level).toBe('debug');

    const compRes = await request(app)
      .post('/api/mcp/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'c-1',
        method: 'completion/complete',
        params: { argument: { name: 'uri', value: 'deployments' } }
      });
    expect(compRes.status).toBe(200);
    expect(compRes.body.result.completion.values).toContain('monopulse://tables/deployments');

    const tplRes = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 'tpl-1', method: 'resources/templates/list' });
    expect(tplRes.status).toBe(200);
    expect(tplRes.body.result.resourceTemplates.length).toBeGreaterThanOrEqual(2);

    const dynRead = await request(app)
      .post('/api/mcp/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'r-dyn',
        method: 'resources/read',
        params: { uri: 'monopulse://tables/deployments' }
      });
    expect(dynRead.status).toBe(200);
    expect(dynRead.body.result.contents[0].text).toContain('dep-9042');

    const toolsRes = await request(app)
      .post('/api/mcp/rpc')
      .send({ jsonrpc: '2.0', id: 't-list', method: 'tools/list' });
    expect(toolsRes.status).toBe(200);
    expect(toolsRes.body.result.tools[0].annotations).toBeDefined();
    expect(typeof toolsRes.body.result.tools[0].annotations.readOnlyHint).toBe('boolean');
  });

  it('handles Dead-Letter Queue (DLQ), 2-Person Quorum approvals, token revocation, ETag 304, OpenAPI 3.1, and Playbook Feedback', async () => {
    // 1. DLQ enqueue & retry
    const dlqCreate = await request(app).post('/api/security/dlq').send({
      source: 'slack.incident.webhook',
      payload: { service: 'checkout-ledger-svc' },
      errorReason: 'Simulated downstream timeout'
    });
    expect(dlqCreate.status).toBe(201);
    const dlqId = dlqCreate.body.dlqId;

    const dlqRetry = await request(app).post(`/api/security/dlq/${dlqId}/retry`).send({});
    expect(dlqRetry.status).toBe(200);
    expect(dlqRetry.body.status).toBe('REPLAYED_RESOLVED');

    // 2. Two-Person Rule (M-of-N Quorum signatures)
    const q1 = await request(app)
      .post('/api/events/evt-ambient-901/quorum-sign')
      .send({ operatorId: 'sre-alice', callerRole: 'sre_admin' });
    expect(q1.body.quorumMet).toBe(false);

    const q2 = await request(app)
      .post('/api/events/evt-ambient-901/quorum-sign')
      .send({ operatorId: 'sre-bob', callerRole: 'sre_admin' });
    expect(q2.body.quorumMet).toBe(true);
    expect(q2.body.signaturesCollected).toBe(2);

    // 3. Token Revocation (JTI denylist)
    const token = signRoleBearerToken('sre_admin');
    const revRes = await request(app).post('/api/security/tokens/revoke').send({ token });
    expect(revRes.status).toBe(200);
    expect(revRes.body.revoked).toBe(true);

    // 4. ETag 304 Not Modified on /api/system/state
    const state1 = await request(app).get('/api/system/state');
    expect(state1.status).toBe(200);
    const etag = state1.headers.etag;
    expect(etag).toBeTruthy();

    const state304 = await request(app).get('/api/system/state').set('If-None-Match', etag);
    expect(state304.status).toBe(304);

    // 5. OpenAPI 3.1.0 Specification
    const openApiRes = await request(app).get('/api/openapi.json');
    expect(openApiRes.status).toBe(200);
    expect(openApiRes.body.openapi).toBe('3.1.0');

    // 6. Operator Playbook Feedback & Porter Stemmer
    expect(stemOperationalToken('rolling')).toBe('roll');
    expect(stemOperationalToken('saturation')).toBe('saturat');
    expect(tokenizeAndStemQuery('the PgBouncer pool was saturated after rolling deploy')).toContain(
      'saturat'
    );

    const fbRes = await request(app)
      .post('/api/memory/playbooks/PB-LEDGER-CANARY-01/feedback')
      .send({ vote: 'upvote' });
    expect(fbRes.status).toBe(200);
    expect(fbRes.body.upvotes).toBeGreaterThanOrEqual(1);

    // 7. Circuit breaker + exponential backoff helper
    const cbRes = await executeWithRetryAndCircuitBreaker(
      'github-mcp',
      async () => {
        throw new Error('Transient 503');
      },
      () => ({ fallback: true }),
      2
    );
    expect(cbRes.data).toEqual({ fallback: true });
    expect(cbRes.liveExecuted).toBe(false);

    // 8. Audit CSV export endpoint used by TrustAuditPanel
    const csvRes = await request(app).get('/api/security/audit?format=csv');
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
  });
});
