import express from 'express';
import { ZodError } from 'zod';
import {
  MCP_SERVERS,
  MCP_TOOLS,
  WIRE_LOG,
  executeMCPToolCall,
  RBACRole
} from './mcpRegistry.ts';
import {
  REDIS_TIER1_STORE,
  PGVECTOR_PLAYBOOKS,
  KAGGLE_GPU_JOBS,
  searchPlaybooksBySemanticSimilarity,
  distillTrajectoryViaKaggleGPU
} from './memoryEngine.ts';
import {
  AMBIENT_EVENTS,
  ingestAmbientWebhookEvent,
  executeStagedApprovalBlock
} from './ambientOrchestrator.ts';
import {
  SQL_TABLES,
  GITHUB_PRS,
  SLACK_THREADS,
  JIRA_TICKETS,
  INTERNAL_DOCS,
  POD_TELEMETRY
} from './sandboxData.ts';
import {
  McpRpcRequestSchema,
  WebhookIngestSchema,
  EventApprovalSchema,
  MemorySearchSchema,
  KaggleDistillSchema,
  CliExecSchema
} from './validationSchemas.ts';
import { createRequestLogContext } from './logger.ts';

export function createMonoPulseApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 0. Health & Readiness Probe Endpoint
  app.get('/api/health', (_req, res) => {
    const reqLogger = createRequestLogContext('GET /api/health');
    reqLogger.info({ status: 'ok', mcpServers: MCP_SERVERS.length }, 'Health probe check');
    res.json({
      status: 'ok',
      service: 'monopulse-mcp-engine',
      version: '1.0.0',
      uptimeSec: Math.round(process.uptime()),
      mcpServersReady: MCP_SERVERS.length,
      mcpToolsReady: MCP_TOOLS.length,
      memoryTiersReady: {
        redisTier1Keys: REDIS_TIER1_STORE.length,
        pgvectorPlaybooks: PGVECTOR_PLAYBOOKS.length
      },
      timestamp: new Date().toISOString()
    });
  });

  // 1. System Snapshot & Telemetry Overview
  app.get('/api/system/state', (_req, res) => {
    const reqLogger = createRequestLogContext('GET /api/system/state');
    const avgStepReduction =
      PGVECTOR_PLAYBOOKS.reduce((acc, p) => acc + p.stepReductionPct, 0) /
      Math.max(1, PGVECTOR_PLAYBOOKS.length);

    reqLogger.info({ eventsCount: AMBIENT_EVENTS.length }, 'Serving system telemetry snapshot');
    res.json({
      engineVersion: 'MonoPulse Core v3.4.0-MCP',
      architecturePosture: 'AMBIENT_EVENT_PRECOMPUTE',
      metrics: {
        mcpServersCount: MCP_SERVERS.length,
        mcpToolsCount: MCP_TOOLS.length,
        avgStepReductionPct: Number(avgStepReduction.toFixed(1)),
        legacyWeekOneAbandonmentPct: 72.0,
        ambientWeeklyActiveRetentionPct: 84.0,
        legacyAvgResponseSec: 46.4,
        ambientPerceivedLatencySec: 0.4
      },
      mcpServers: MCP_SERVERS,
      mcpTools: MCP_TOOLS,
      wireLog: WIRE_LOG,
      ambientEvents: AMBIENT_EVENTS,
      redisTier1: REDIS_TIER1_STORE,
      pgvectorPlaybooks: PGVECTOR_PLAYBOOKS,
      kaggleGpuJobs: KAGGLE_GPU_JOBS,
      sandboxSnapshot: {
        sqlTables: Object.keys(SQL_TABLES),
        jiraTickets: JIRA_TICKETS,
        githubPrs: GITHUB_PRS,
        slackThreads: SLACK_THREADS,
        internalDocs: INTERNAL_DOCS,
        podTelemetry: POD_TELEMETRY
      }
    });
  });

  // 2. JSON-RPC 2.0 MCP Tool Execution Boundary
  app.post('/api/mcp/rpc', (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/mcp/rpc');
    try {
      const parsed = McpRpcRequestSchema.parse(req.body);
      if (parsed.method === 'tools/list') {
        reqLogger.info('Listing registered MCP servers and tools');
        res.json({
          jsonrpc: '2.0',
          id: parsed.id || 'rpc-list',
          result: { servers: MCP_SERVERS, tools: MCP_TOOLS }
        });
        return;
      }

      const toolName = parsed.params?.name || parsed.toolName || '';
      const args = (parsed.params?.arguments || parsed.args || {}) as Record<string, any>;
      const callerRole: RBACRole =
        parsed.params?.callerRole || parsed.callerRole || 'readonly_analyst';
      const approvalToken = parsed.params?.approvalToken || parsed.approvalToken;

      const outcome = executeMCPToolCall({ toolName, args, callerRole, approvalToken });
      reqLogger.info(
        { toolName, callerRole, status: outcome.status, httpCode: outcome.httpCode },
        'Executed MCP tool call across boundary'
      );
      res.status(outcome.httpCode).json(outcome);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        reqLogger.warn({ issues: err.issues }, 'Zod request validation failed on /api/mcp/rpc');
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          details: err.issues
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal MCP RPC error';
      reqLogger.error({ err: message }, 'Unhandled error on /api/mcp/rpc');
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message }
      });
    }
  });

  // 3. Ambient Event Webhook Ingest
  app.post('/api/webhooks/ingest', async (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/webhooks/ingest');
    try {
      const parsed = WebhookIngestSchema.parse(req.body);
      const event = await ingestAmbientWebhookEvent(parsed);
      reqLogger.info(
        { eventId: event.eventId, service: event.service, latencyMs: event.precomputeLatencyMs },
        'Ingested and pre-computed ambient webhook event'
      );
      res.json({ status: 'PRECOMPUTED_AND_STAGED', event });
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        reqLogger.warn({ issues: err.issues }, 'Zod validation error on /api/webhooks/ingest');
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : 'Webhook ingestion failed';
      reqLogger.error({ err: message }, 'Webhook ingestion error');
      res.status(500).json({ error: message });
    }
  });

  // 4. 1-Click Approve / Edit Staged Mutation Execution
  app.post('/api/events/:eventId/approve', (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/events/:eventId/approve');
    try {
      const parsed = EventApprovalSchema.parse(req.body || {});
      const outcome = executeStagedApprovalBlock({
        eventId: req.params.eventId,
        callerRole: parsed.callerRole,
        editedMutations: parsed.editedMutations as
          | { id: string; args: Record<string, any> }[]
          | undefined
      });
      reqLogger.info(
        { eventId: req.params.eventId, callerRole: parsed.callerRole, success: outcome.success },
        'Processed 1-Click Approval Block'
      );
      res.json(outcome);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        reqLogger.warn({ issues: err.issues }, 'Zod validation error on /api/events/:id/approve');
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : 'Approval execution failed';
      reqLogger.warn({ err: message }, 'Approval execution rejected');
      res.status(400).json({ error: message });
    }
  });

  // 5. Two-Tier Memory Semantic Playbook Search
  app.post('/api/memory/search', async (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/memory/search');
    try {
      const parsed = MemorySearchSchema.parse(req.body);
      const result = await searchPlaybooksBySemanticSimilarity(parsed.query, parsed.topK);
      reqLogger.info(
        { topPlaybook: result.matches[0]?.playbook.id, model: result.embeddingModelUsed },
        'Executed pgvector semantic similarity search'
      );
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        reqLogger.warn({ issues: err.issues }, 'Zod validation error on /api/memory/search');
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : 'Semantic search failed';
      reqLogger.error({ err: message }, 'Memory search failed');
      res.status(500).json({ error: message });
    }
  });

  // 6. Kaggle GPU Playbook Extractor & Trajectory Distillation Bridge
  app.post('/api/kaggle/distill', async (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/kaggle/distill');
    try {
      const parsed = KaggleDistillSchema.parse(req.body || {});
      const sourceEvent =
        AMBIENT_EVENTS.find((e) => e.eventId === parsed.eventId) || AMBIENT_EVENTS[0];

      const executedTools = [
        ...sourceEvent.autonomousReadOnlyTrace.map((t) => ({
          toolName: t.toolName,
          args: t.args,
          outcomeSummary: t.findingSummary
        })),
        ...sourceEvent.stagedMutations.map((m) => ({
          toolName: m.toolName,
          args: m.args,
          outcomeSummary: m.description
        }))
      ];

      const outcome = await distillTrajectoryViaKaggleGPU({
        trajectoryId: `traj-${sourceEvent.eventId}`,
        incidentSummary: parsed.customIncidentSummary || sourceEvent.incomingPayloadSummary,
        service: parsed.customService || sourceEvent.service,
        executedTools
      });

      reqLogger.info(
        { jobId: outcome.job.jobId, extractedPlaybookId: outcome.newPlaybook.id },
        'Completed Kaggle GPU trajectory distillation'
      );
      res.json(outcome);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        reqLogger.warn({ issues: err.issues }, 'Zod validation error on /api/kaggle/distill');
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : 'Kaggle GPU distillation failed';
      reqLogger.error({ err: message }, 'Kaggle GPU distillation error');
      res.status(500).json({ error: message });
    }
  });

  // 7. Interactive CLI Harness Command Processor
  app.post('/api/cli/exec', async (req, res) => {
    const reqLogger = createRequestLogContext('POST /api/cli/exec');
    try {
      const parsed = CliExecSchema.parse(req.body);
      const rawCmd = parsed.command.trim();
      const callerRole: RBACRole = parsed.callerRole;
      reqLogger.info({ command: rawCmd, callerRole }, 'Executing CLI harness command');

      if (rawCmd === 'help' || rawCmd === 'monopulse help') {
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: `MonoPulse Operations Engine CLI (v3.4.0-MCP)
Available commands:
  monopulse mcp list                           List all 6 custom MCP servers and 28 deterministic tools
  monopulse mcp call <tool> '<json_args>'      Execute a JSON-RPC 2.0 tool call through RBAC & Schema boundary
  monopulse rbac test-unauthorized             Test RBAC & SQL mutation rejection at the protocol boundary
  monopulse webhook emit <ledger|webhook>      Ingest an ambient event and pre-compute 1-Click Approval Block
  monopulse approve <event_id>                 Execute staged 1-Click Approval mutations for an event
  monopulse memory search "<query>"            Run pgvector cosine similarity search & prompt skill injection
  monopulse kaggle distill <event_id>          Offload trajectory distillation to Kaggle GPU bridge`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse mcp list')) {
        const lines = MCP_SERVERS.map((s) => {
          const serverTools = MCP_TOOLS.filter((t) => t.serverId === s.id);
          return (
            `[${s.id}] (${s.domain}) — ${serverTools.length} tools:\n` +
            serverTools
              .map(
                (t) =>
                  `  • ${t.name.padEnd(32)} | ${t.isMutation ? 'MUTATION ' : 'READ-ONLY'} | roles: [${t.allowedRoles.join(', ')}]`
              )
              .join('\n')
          );
        }).join('\n\n');
        res.json({ command: rawCmd, exitCode: 0, output: lines });
        return;
      }

      if (rawCmd.startsWith('monopulse rbac test-unauthorized')) {
        const r1 = executeMCPToolCall({
          toolName: 'infra_trigger_canary_rollback',
          args: { deploy_id: 'dep-9042', reason: 'Attempted unauthorized rollback' },
          callerRole: 'readonly_analyst'
        });
        const r2 = executeMCPToolCall({
          toolName: 'sql_execute_readonly_query',
          args: { query: "DELETE FROM deployments WHERE deploy_id = 'dep-9042'" },
          callerRole: 'sre_admin'
        });
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: `[TEST 1: Privilege Escalation Attempt by 'readonly_analyst']\nStatus: ${r1.status} (HTTP ${r1.httpCode})\nJSON-RPC Error: ${JSON.stringify(r1.error, null, 2)}\n\n[TEST 2: Destructive SQL DML Injection on 'sql-ops-mcp']\nStatus: ${r2.status} (HTTP ${r2.httpCode})\nJSON-RPC Error: ${JSON.stringify(r2.error, null, 2)}`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse mcp call')) {
        const parts = rawCmd.replace('monopulse mcp call', '').trim();
        const firstSpace = parts.indexOf(' ');
        const toolName = firstSpace === -1 ? parts : parts.slice(0, firstSpace).trim();
        const rawJson =
          firstSpace === -1 ? '{}' : parts.slice(firstSpace + 1).trim().replace(/^'|'$/g, '');
        const parsedArgs = JSON.parse(rawJson);
        const rpc = executeMCPToolCall({ toolName, args: parsedArgs, callerRole });
        res.json({
          command: rawCmd,
          exitCode: rpc.status === 'SUCCESS' ? 0 : 1,
          output: JSON.stringify(rpc, null, 2)
        });
        return;
      }

      if (rawCmd.startsWith('monopulse webhook emit')) {
        const isWebhookSvc = rawCmd.includes('webhook');
        const evt = await ingestAmbientWebhookEvent({
          source: isWebhookSvc ? 'jira.issue.created' : 'slack.incident.webhook',
          service: isWebhookSvc ? 'webhook-dispatcher-v2' : 'checkout-ledger-svc',
          channelOrTicket: isWebhookSvc
            ? 'OPS-4819 · #tier2-customer-escalations'
            : '#inc-prod-alerts · OPS-4821',
          payloadSummary: isWebhookSvc
            ? 'CLI Trigger: Cross-region webhook TLS ETIMEDOUT spike on eu-central-1 tenants after PR #1835.'
            : 'CLI Trigger: P0 checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) on canary dep-9042.'
        });
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: `Ambient Event Ingested & Pre-Computed in ${evt.precomputeLatencyMs}ms\nEvent ID: ${evt.eventId}\nMatched Playbook: ${evt.matchedPlaybook?.id}\nRoot Cause: ${evt.rootCauseSynthesis}`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse approve')) {
        const targetId =
          rawCmd.replace('monopulse approve', '').trim() || AMBIENT_EVENTS[0]?.eventId;
        const result = executeStagedApprovalBlock({ eventId: targetId, callerRole });
        res.json({
          command: rawCmd,
          exitCode: result.success ? 0 : 1,
          output: JSON.stringify(result, null, 2)
        });
        return;
      }

      if (rawCmd.startsWith('monopulse memory search')) {
        const query =
          rawCmd.replace('monopulse memory search', '').trim().replace(/^"|"$|^'|'$/g, '') ||
          'PgBouncer connection pool exhaustion on checkout-ledger-svc';
        const searchRes = await searchPlaybooksBySemanticSimilarity(query, 3);
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: JSON.stringify(searchRes, null, 2)
        });
        return;
      }

      if (rawCmd.startsWith('monopulse kaggle distill')) {
        const evtId =
          rawCmd.replace('monopulse kaggle distill', '').trim() || AMBIENT_EVENTS[0]?.eventId;
        const evt = AMBIENT_EVENTS.find((e) => e.eventId === evtId) || AMBIENT_EVENTS[0];
        const distillRes = await distillTrajectoryViaKaggleGPU({
          trajectoryId: `traj-${evt.eventId}`,
          incidentSummary: evt.incomingPayloadSummary,
          service: evt.service,
          executedTools: evt.autonomousReadOnlyTrace.map((t) => ({
            toolName: t.toolName,
            args: t.args,
            outcomeSummary: t.findingSummary
          }))
        });
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: JSON.stringify(distillRes.job, null, 2)
        });
        return;
      }

      res.json({
        command: rawCmd,
        exitCode: 1,
        output: `Unknown command '${rawCmd}'. Type 'monopulse help' for available commands.`
      });
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
        return;
      }
      const message = err instanceof Error ? err.message : 'CLI execution failed';
      res.status(500).json({ command: req.body?.command, exitCode: 1, output: message });
    }
  });

  return app;
}
