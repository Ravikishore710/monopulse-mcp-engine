import { Router } from 'express';
import { ZodError } from 'zod';
import {
  revokeSecurityToken,
  signApprovalToken,
  signRoleBearerToken,
  verifyApprovalToken
} from './cryptoSecurity.ts';
import { getSqliteAuditLogs, getSqliteDatabaseSummary } from './sqliteEngine.ts';
import {
  getConnectorStatusSummary,
  isSimulationModeActive,
  setSimulationModeActive,
  verifyLiveExternalConnectors
} from './liveConnectors.ts';
import {
  enqueueDlqEntry,
  exportSqliteSnapshotJson,
  listDlqEntries,
  markDlqRetried,
  pruneAuditLogRetention,
  recordQuorumApprovalSignature,
  sanitizeCsvCell,
  verifyAuditHashChain
} from './durableLedger.ts';
import { getOpenApi31Specification } from './mcpProtocolSpec.ts';
import { PlaybookFeedbackSchema, RBACRoleSchema } from './validationSchemas.ts';
import { recordPlaybookFeedback } from './memoryRanker.ts';
import { createSlackWorkspaceRouter } from './slackWorkspaceEngine.ts';
import { createCustomIntegrationsRouter } from './customIntegrationsEngine.ts';
import { broadcastSseEvent } from './observabilityEngine.ts';
import { SimulationDataService } from './simulationDataService.ts';
import { SystemLoadStressTest } from './systemLoadStressTest.ts';

export function createSecurityAndGovernanceRouter(): Router {
  const router = Router();
  router.use(createSlackWorkspaceRouter());
  router.use(createCustomIntegrationsRouter());

  // Simulation Mode Toggle (Mock External MCP Connectors + Populate SQL_TABLES, JIRA_TICKETS, SLACK_THREADS)
  router.get('/api/system/simulation', (_req, res) => {
    res.json({
      simulationMode: isSimulationModeActive(),
      simulationDataset: SimulationDataService.getDatasetSummary(),
      connectors: getConnectorStatusSummary()
    });
  });

  router.post('/api/system/simulation', (req, res) => {
    const nextState =
      typeof req.body?.enabled === 'boolean' ? req.body.enabled : !isSimulationModeActive();
    const active = setSimulationModeActive(nextState);
    const dataset = active
      ? SimulationDataService.populateSimulationData()
      : SimulationDataService.getDatasetSummary();
    broadcastSseEvent('simulation.toggled', { simulationMode: active, seeded: dataset.seeded });
    res.json({
      simulationMode: active,
      simulationDataset: dataset,
      modeDescription: active
        ? 'SIMULATION_MOCK_ACTIVE (All external Slack, Jira, and GitHub connectors isolated to deterministic sandbox data)'
        : 'PRODUCTION_DUAL_MODE (Live external REST connectors active where credentials exist)',
      connectors: getConnectorStatusSummary()
    });
  });

  // High-Concurrency Multi-User Burst Load & Stress Test Endpoints
  router.post(['/api/system/load-test', '/api/system/stress-test'], async (req, res) => {
    const report = await SystemLoadStressTest.runStressTest({
      webhookBurstSize: typeof req.body?.webhookBurstSize === 'number' ? req.body.webhookBurstSize : undefined,
      rpcBurstSize: typeof req.body?.rpcBurstSize === 'number' ? req.body.rpcBurstSize : undefined,
      competingApprovers: typeof req.body?.competingApprovers === 'number' ? req.body.competingApprovers : undefined
    });
    broadcastSseEvent('simulation.toggled', { simulationMode: true, loadTestCompleted: true });
    res.json(report);
  });

  // OpenAPI 3.1.0 Specification
  router.get('/api/openapi.json', (_req, res) => {
    res.json(getOpenApi31Specification());
  });

  // Live External Connector Probe (GitHub REST v3 & Jira Cloud REST v3)
  router.get('/api/security/connectors/verify', async (_req, res) => {
    const verification = await verifyLiveExternalConnectors();
    res.json({
      simulationMode: isSimulationModeActive(),
      connectors: getConnectorStatusSummary(),
      liveVerification: verification
    });
  });

  // Issue Signed Bearer RBAC Token
  router.post('/api/auth/token', (req, res) => {
    const parsedRole = RBACRoleSchema.safeParse(req.body?.role || 'sre_admin');
    const role = parsedRole.success ? parsedRole.data : 'readonly_analyst';
    res.json({
      role,
      bearerToken: signRoleBearerToken(role),
      tokenType: 'Bearer',
      algorithm: 'HMAC-SHA256'
    });
  });

  // Revoke Compromised Bearer or Approval Token
  router.post('/api/security/tokens/revoke', (req, res) => {
    const token = String(req.body?.token || '');
    if (!token) {
      res.status(400).json({ error: 'Token string required for revocation' });
      return;
    }
    const result = revokeSecurityToken(token);
    res.json({ status: 'TOKEN_REVOKED', ...result });
  });

  // Cryptographic SHA-256 Hash-Chain Audit Verification
  router.get('/api/security/hash-chain/verify', (_req, res) => {
    res.json(verifyAuditHashChain());
  });

  // SQLite Snapshot Backup & Retention Prune
  router.get('/api/security/sqlite-backup', (_req, res) => {
    pruneAuditLogRetention(5000);
    res.json(exportSqliteSnapshotJson());
  });

  // Dead-Letter Queue (DLQ) Inspection & Replay
  router.get('/api/security/dlq', (_req, res) => {
    res.json({ entries: listDlqEntries() });
  });

  router.post('/api/security/dlq', (req, res) => {
    const { source = 'webhook.failed', payload = {}, errorReason = 'Upstream timeout' } =
      req.body || {};
    const entry = enqueueDlqEntry({ source, payload, errorReason });
    res.status(201).json(entry);
  });

  router.post('/api/security/dlq/:dlqId/retry', (req, res) => {
    const ok = markDlqRetried(req.params.dlqId);
    if (!ok) {
      res.status(404).json({ error: `DLQ entry '${req.params.dlqId}' not found` });
      return;
    }
    res.json({ status: 'REPLAYED_RESOLVED', dlqId: req.params.dlqId });
  });

  // Two-Person Rule (M-of-N Quorum Signature Collection)
  router.post('/api/events/:eventId/quorum-sign', (req, res) => {
    const operatorId = String(req.body?.operatorId || 'sre-oncall-primary');
    const callerRole = String(req.body?.callerRole || 'sre_admin');
    const quorum = recordQuorumApprovalSignature({
      eventId: req.params.eventId,
      operatorId,
      callerRole
    });
    res.json(quorum);
  });

  // Operator Playbook Feedback (Upvote / Downvote / Markdown Refinement)
  router.post('/api/memory/playbooks/:playbookId/feedback', (req, res) => {
    try {
      const parsed = PlaybookFeedbackSchema.parse(req.body || {});
      const outcome = recordPlaybookFeedback({
        playbookId: req.params.playbookId,
        vote: parsed.vote,
        editedMarkdown: parsed.editedMarkdown
      });
      if (!outcome.found) {
        res.status(404).json({ error: `Playbook '${req.params.playbookId}' not found` });
        return;
      }
      res.json(outcome);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      res.status(500).json({ error: 'Failed to record playbook feedback' });
    }
  });

  // Production SQLite & Cryptographic Audit Inspector (JSON & Formula-Safe CSV Export)
  router.get('/api/security/audit', (req, res) => {
    const logs = getSqliteAuditLogs(60);
    if (req.query.format === 'csv') {
      const header =
        'frame_id,timestamp,server_id,tool_name,caller_role,is_mutation,approval_token_provided,status,latency_ms';
      const rows = logs.map((r) =>
        [
          sanitizeCsvCell(r.frame_id),
          sanitizeCsvCell(r.timestamp),
          sanitizeCsvCell(r.server_id),
          sanitizeCsvCell(r.tool_name),
          sanitizeCsvCell(r.caller_role),
          sanitizeCsvCell(r.is_mutation),
          sanitizeCsvCell(r.approval_token_provided),
          sanitizeCsvCell(r.status),
          sanitizeCsvCell(r.latency_ms)
        ].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send([header, ...rows].join('\n'));
      return;
    }

    res.json({
      sqliteDatabase: getSqliteDatabaseSummary(),
      connectorModes: getConnectorStatusSummary(),
      hashChainIntegrity: verifyAuditHashChain(),
      deadLetterQueue: listDlqEntries(),
      securityPosture: {
        webhookSignatureAlgorithm: 'HMAC-SHA256 (crypto.timingSafeEqual + 300s Replay Window + Keyring Rotation)',
        approvalTokenAlgorithm: 'HMAC-SHA256 (mp_sig_v1.<exp>.<argsDigest>.<hmac> + JTI Revocation)',
        auditHashChainAlgorithm: 'SHA-256 Tamper-Evident Merkle Chain (audit_hash_chain)',
        bearerRoleTokenSample: signRoleBearerToken('sre_admin'),
        rateLimitMaxPerMinute: 240,
        securityHeadersActive: [
          'X-Content-Type-Options: nosniff',
          'X-Frame-Options: SAMEORIGIN',
          'Strict-Transport-Security: max-age=31536000; includeSubDomains',
          'Content-Security-Policy',
          'traceparent (W3C Trace Context)'
        ]
      },
      auditLogEntries: logs
    });
  });

  router.post('/api/security/verify-signature', (req, res) => {
    const { toolName = 'infra_trigger_canary_rollback', args = {}, tamperArgs } = req.body || {};
    const issuedToken = signApprovalToken({ toolName, args });
    const verification = verifyApprovalToken({
      token: issuedToken,
      toolName,
      args: tamperArgs || args
    });
    res.json({
      issuedToken,
      testedArgs: tamperArgs || args,
      tampered: Boolean(tamperArgs),
      verification
    });
  });

  return router;
}
