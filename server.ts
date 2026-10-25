import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  MCP_SERVERS,
  MCP_TOOLS,
  WIRE_LOG,
  executeMCPToolCall,
  RBACRole
} from './src/server/mcpRegistry.ts';
import {
  REDIS_TIER1_STORE,
  PGVECTOR_PLAYBOOKS,
  KAGGLE_GPU_JOBS,
  searchPlaybooksBySemanticSimilarity,
  distillTrajectoryViaKaggleGPU
} from './src/server/memoryEngine.ts';
import {
  AMBIENT_EVENTS,
  ingestAmbientWebhookEvent,
  executeStagedApprovalBlock
} from './src/server/ambientOrchestrator.ts';
import {
  SQL_TABLES,
  GITHUB_PRS,
  SLACK_THREADS,
  JIRA_TICKETS,
  INTERNAL_DOCS,
  POD_TELEMETRY
} from './src/server/sandboxData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  // 1. System Snapshot & Telemetry Overview
  app.get('/api/system/state', (_req, res) => {
    const avgStepReduction =
      PGVECTOR_PLAYBOOKS.reduce((acc, p) => acc + p.stepReductionPct, 0) /
      Math.max(1, PGVECTOR_PLAYBOOKS.length);

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
    try {
      const { method, params } = req.body || {};
      if (method === 'tools/list') {
        res.json({
          jsonrpc: '2.0',
          id: req.body?.id || 'rpc-list',
          result: { servers: MCP_SERVERS, tools: MCP_TOOLS }
        });
        return;
      }

      const toolName = params?.name || req.body?.toolName;
      const args = params?.arguments || req.body?.args || {};
      const callerRole: RBACRole =
        params?.callerRole || req.body?.callerRole || 'readonly_analyst';
      const approvalToken = params?.approvalToken || req.body?.approvalToken;

      const outcome = executeMCPToolCall({
        toolName,
        args,
        callerRole,
        approvalToken
      });

      res.status(outcome.httpCode).json(outcome);
    } catch (err: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err?.message || 'Internal MCP RPC error' }
      });
    }
  });

  // 3. Ambient Event Webhook Ingest (Solves the 72% Abandonment War Story)
  app.post('/api/webhooks/ingest', async (req, res) => {
    try {
      const { source, service, channelOrTicket, payloadSummary } = req.body || {};
      const event = await ingestAmbientWebhookEvent({
        source: source || 'slack.incident.webhook',
        service: service || 'checkout-ledger-svc',
        channelOrTicket: channelOrTicket || '#inc-prod-alerts · OPS-4821',
        payloadSummary:
          payloadSummary ||
          '[FIRING: P0] checkout-ledger-svc 5xx spike (14.8%) and PgBouncer pool saturation (98%) on canary dep-9042.'
      });
      res.json({ status: 'PRECOMPUTED_AND_STAGED', event });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Webhook ingestion failed' });
    }
  });

  // 4. 1-Click Approve / Edit Staged Mutation Execution
  app.post('/api/events/:eventId/approve', (req, res) => {
    try {
      const { eventId } = req.params;
      const { callerRole, editedMutations } = req.body || {};
      const outcome = executeStagedApprovalBlock({
        eventId,
        callerRole: (callerRole as RBACRole) || 'sre_admin',
        editedMutations
      });
      res.json(outcome);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Approval execution failed' });
    }
  });

  // 5. Two-Tier Memory Semantic Playbook Search (pgvector + Gemini Embedding 2)
  app.post('/api/memory/search', async (req, res) => {
    try {
      const { query, topK } = req.body || {};
      const result = await searchPlaybooksBySemanticSimilarity(
        String(query || 'PgBouncer connection pool exhaustion on checkout-ledger-svc canary'),
        Number(topK || 3)
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Semantic search failed' });
    }
  });

  // 6. Kaggle GPU Playbook Extractor & Trajectory Distillation Bridge
  app.post('/api/kaggle/distill', async (req, res) => {
    try {
      const { eventId, customIncidentSummary, customService } = req.body || {};
      const sourceEvent = AMBIENT_EVENTS.find((e) => e.eventId === eventId) || AMBIENT_EVENTS[0];

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
        incidentSummary: customIncidentSummary || sourceEvent.incomingPayloadSummary,
        service: customService || sourceEvent.service,
        executedTools
      });

      res.json(outcome);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Kaggle GPU distillation failed' });
    }
  });

  // 7. Interactive CLI Harness Command Processor
  app.post('/api/cli/exec', async (req, res) => {
    try {
      const rawCmd = String(req.body?.command || '').trim();
      const callerRole: RBACRole = req.body?.callerRole || 'sre_admin';

      if (!rawCmd || rawCmd === 'help' || rawCmd === 'monopulse help') {
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
          return `[${s.id}] (${s.domain}) — ${serverTools.length} tools:\n` +
            serverTools
              .map(
                (t) =>
                  `  • ${t.name.padEnd(32)} | ${t.isMutation ? 'MUTATION ' : 'READ-ONLY'} | roles: [${t.allowedRoles.join(', ')}]`
              )
              .join('\n');
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
          output: `[TEST 1: Privilege Escalation Attempt by 'readonly_analyst']
Status: ${r1.status} (HTTP ${r1.httpCode})
JSON-RPC Error: ${JSON.stringify(r1.error, null, 2)}

[TEST 2: Destructive SQL DML Injection on 'sql-ops-mcp']
Status: ${r2.status} (HTTP ${r2.httpCode})
JSON-RPC Error: ${JSON.stringify(r2.error, null, 2)}`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse mcp call')) {
        const parts = rawCmd.replace('monopulse mcp call', '').trim();
        const firstSpace = parts.indexOf(' ');
        const toolName = firstSpace === -1 ? parts : parts.slice(0, firstSpace).trim();
        const rawJson = firstSpace === -1 ? '{}' : parts.slice(firstSpace + 1).trim().replace(/^'|'$/g, '');
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(rawJson);
        } catch (e: any) {
          res.json({
            command: rawCmd,
            exitCode: 1,
            output: `Invalid JSON arguments: ${e?.message}\nExample: monopulse mcp call sql_inspect_table_schema '{"table_name":"deployments"}'`
          });
          return;
        }
        const rpc = executeMCPToolCall({ toolName, args: parsedArgs, callerRole });
        res.json({
          command: rawCmd,
          exitCode: rpc.status === 'SUCCESS' ? 0 : 1,
          output: JSON.stringify(
            {
              jsonrpc: rpc.jsonrpc,
              id: rpc.id,
              status: rpc.status,
              callerRole,
              result: rpc.result,
              error: rpc.error
            },
            null,
            2
          )
        });
        return;
      }

      if (rawCmd.startsWith('monopulse webhook emit')) {
        const isWebhookSvc = rawCmd.includes('webhook');
        const evt = await ingestAmbientWebhookEvent({
          source: isWebhookSvc ? 'jira.issue.created' : 'slack.incident.webhook',
          service: isWebhookSvc ? 'webhook-dispatcher-v2' : 'checkout-ledger-svc',
          channelOrTicket: isWebhookSvc ? 'OPS-4819 · #tier2-customer-escalations' : '#inc-prod-alerts · OPS-4821',
          payloadSummary: isWebhookSvc
            ? 'CLI Trigger: Cross-region webhook TLS ETIMEDOUT spike on eu-central-1 tenants after PR #1835.'
            : 'CLI Trigger: P0 checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) on canary dep-9042.'
        });
        res.json({
          command: rawCmd,
          exitCode: 0,
          output: `Ambient Event Ingested & Pre-Computed in ${evt.precomputeLatencyMs}ms (Perceived Wait: 0ms)
Event ID:         ${evt.eventId}
Matched Playbook: ${evt.matchedPlaybook?.id} (Cosine Sim: ${evt.matchedPlaybook?.cosineSimilarity}, Step Savings: -${evt.matchedPlaybook?.stepReductionPct}%)
Autonomous Steps: ${evt.autonomousReadOnlyTrace.map((t) => t.toolName).join(' -> ')}
Root Cause:       ${evt.rootCauseSynthesis}
Staged 1-Click:   ${evt.stagedMutations.map((m) => m.toolName).join(', ')} (Run 'monopulse approve ${evt.eventId}')`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse approve')) {
        const targetId = rawCmd.replace('monopulse approve', '').trim() || AMBIENT_EVENTS[0]?.eventId;
        const result = executeStagedApprovalBlock({
          eventId: targetId,
          callerRole
        });
        res.json({
          command: rawCmd,
          exitCode: result.success ? 0 : 1,
          output: JSON.stringify(
            {
              eventId: result.event.eventId,
              approvalState: result.event.approvalState,
              approvedByRole: callerRole,
              executedMutations: result.results
            },
            null,
            2
          )
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
          output: `Tier-2 pgvector Cosine Similarity Search (Model: ${searchRes.embeddingModelUsed})
Query Vector [0..7]: [${searchRes.queryVectorPreview.join(', ')}]

Top Matches:
${searchRes.matches
  .map(
    (m, i) =>
      `  ${i + 1}. [${m.playbook.id}] ${m.playbook.title}\n     Cosine Similarity: ${m.cosineSimilarity} | Step Reduction: -${m.playbook.stepReductionPct}% | Injected: ${m.injectedIntoPrompt}`
  )
  .join('\n')}

Constructed System Prompt Injection:
${searchRes.constructedSystemPrompt}`
        });
        return;
      }

      if (rawCmd.startsWith('monopulse kaggle distill')) {
        const evtId = rawCmd.replace('monopulse kaggle distill', '').trim() || AMBIENT_EVENTS[0]?.eventId;
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
          output: `Kaggle GPU Trajectory Distillation Completed:
Job ID:            ${distillRes.job.jobId}
Kernel Slug:       ${distillRes.job.kernelSlug} (${distillRes.job.accelerator})
Extracted Skill:   ${distillRes.newPlaybook.id} — ${distillRes.newPlaybook.title}
Step Reduction:    ${distillRes.job.rawStepCount} steps -> ${distillRes.job.distilledStepCount} steps (-${distillRes.job.stepReductionPct}%)

${distillRes.newPlaybook.markdownSkill}`
        });
        return;
      }

      res.json({
        command: rawCmd,
        exitCode: 1,
        output: `Unknown command '${rawCmd}'. Type 'monopulse help' for available commands.`
      });
    } catch (err: any) {
      res.status(500).json({
        command: req.body?.command,
        exitCode: 1,
        output: `CLI Error: ${err?.message || 'Execution failed'}`
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MonoPulse Core Engine] Listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
