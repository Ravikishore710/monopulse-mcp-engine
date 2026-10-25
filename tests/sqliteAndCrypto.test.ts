import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMonoPulseApp } from '../src/server/app.ts';
import {
  computeWebhookSignature,
  signApprovalToken,
  verifyApprovalToken,
  verifyWebhookSignature
} from '../src/server/cryptoSecurity.ts';
import { executeMCPToolCall } from '../src/server/mcpRegistry.ts';
import {
  executeSqliteReadOnlyQuery,
  explainSqliteQueryPlan,
  getSqliteAuditLogs,
  getSqliteDatabaseSummary,
  inspectSqliteTableSchema
} from '../src/server/sqliteEngine.ts';
import { getConnectorStatusSummary } from '../src/server/liveConnectors.ts';

describe('Embedded SQLite Engine, HMAC-SHA256 Cryptography & API Hardening', () => {
  const app = createMonoPulseApp();

  it('initializes and seeds embedded SQLite tables and executes relational JOIN queries', () => {
    const summary = getSqliteDatabaseSummary();
    expect(summary.tables.length).toBeGreaterThanOrEqual(5);

    const joinRes = executeSqliteReadOnlyQuery(
      "SELECT d.deploy_id, d.service, d.status, i.error_rate_pct FROM deployments d JOIN service_incidents i ON d.service = i.service WHERE d.service = 'checkout-ledger-svc'",
      10
    );
    expect(joinRes.readOnlyVerified).toBe(true);
    expect(joinRes.rowCount).toBe(1);
    expect(joinRes.rows[0].deploy_id).toBe('dep-9042');
    expect(joinRes.rows[0].error_rate_pct).toBe(14.8);
  });

  it('inspects live SQLite table schemas via PRAGMA and generates SQLite query plans', () => {
    const schema = inspectSqliteTableSchema('deployments');
    expect(schema.tableName).toBe('deployments');
    expect(schema.liveRowCount).toBeGreaterThanOrEqual(3);
    expect(schema.columns.some((c) => c.name === 'deploy_id')).toBe(true);

    const plan = explainSqliteQueryPlan("SELECT * FROM deployments WHERE deploy_id = 'dep-9042'");
    expect(plan.Plan.Sqlite_Plan_Steps.length).toBeGreaterThan(0);
  });

  it('persists MCP wire frames into the SQLite mcp_audit_log table', () => {
    executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT deploy_id, status FROM deployments', row_limit: 5 },
      callerRole: 'readonly_analyst'
    });

    const auditRows = getSqliteAuditLogs(10);
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].tool_name).toBe('sql_execute_readonly_query');
  });

  it('signs and verifies HMAC-SHA256 approval tokens and rejects tampered arguments', () => {
    const originalArgs = { deploy_id: 'dep-9042', reason: 'Authorized SRE rollback' };
    const token = signApprovalToken({
      eventId: 'evt-901',
      toolName: 'infra_trigger_canary_rollback',
      args: originalArgs
    });

    expect(token.startsWith('mp_sig_v1.')).toBe(true);

    const validCheck = verifyApprovalToken({
      token,
      toolName: 'infra_trigger_canary_rollback',
      args: originalArgs
    });
    expect(validCheck.valid).toBe(true);
    expect(validCheck.cryptographic).toBe(true);

    const tamperedCheck = verifyApprovalToken({
      token,
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9041-TAMPERED', reason: 'Authorized SRE rollback' }
    });
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.reason).toContain('tampered');

    const rpcTampered = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9041-TAMPERED', reason: 'Authorized SRE rollback' },
      callerRole: 'sre_admin',
      approvalToken: token
    });
    expect(rpcTampered.status).toBe('RBAC_DENIED');
    expect(rpcTampered.httpCode).toBe(403);
    expect(rpcTampered.error?.code).toBe(-32005);
  });

  it('computes and verifies HMAC-SHA256 webhook signatures and rejects forged signatures on /api/webhooks/ingest', async () => {
    const payload = {
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts',
      payloadSummary: 'P0 5xx error spike on checkout-ledger-svc'
    };

    const validSig = computeWebhookSignature(payload);
    expect(verifyWebhookSignature(payload, validSig)).toBe(true);
    expect(verifyWebhookSignature(payload, 'sha256=00000000000000000000000000000000')).toBe(false);

    const rejectedRes = await request(app)
      .post('/api/webhooks/ingest')
      .set('X-MonoPulse-Signature-256', 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
      .send(payload);
    expect(rejectedRes.status).toBe(401);
    expect(rejectedRes.body.status).toBe('WEBHOOK_SIGNATURE_INVALID');

    const acceptedRes = await request(app)
      .post('/api/webhooks/ingest')
      .set('X-MonoPulse-Signature-256', validSig)
      .send(payload);
    expect(acceptedRes.status).toBe(200);
    expect(acceptedRes.body.signatureVerified).toBe(true);
  });

  it('attaches security headers, rate-limit headers, and serves /api/security/audit and connector statuses', async () => {
    const connectors = getConnectorStatusSummary();
    expect(connectors).toHaveLength(6);

    const res = await request(app).get('/api/security/audit');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.body.sqliteDatabase.engine).toContain('SQLite');
    expect(res.body.connectorModes).toHaveLength(6);
  });
});
