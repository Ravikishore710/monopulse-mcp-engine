#!/usr/bin/env node
import { MCP_SERVERS, MCP_TOOLS, executeMCPToolCall } from './src/server/mcpRegistry.ts';
import {
  searchPlaybooksBySemanticSimilarity,
  distillTrajectoryViaKaggleGPU
} from './src/server/memoryEngine.ts';
import {
  AMBIENT_EVENTS,
  ingestAmbientWebhookEvent,
  executeStagedApprovalBlock
} from './src/server/ambientOrchestrator.ts';
import { logger } from './src/server/logger.ts';

async function main() {
  const args = process.argv.slice(2);
  const sub = args.join(' ').trim() || 'help';

  if (sub === 'help' || sub === '--help') {
    logger.info(
      {
        commands: [
          'npm run cli -- mcp list',
          'npm run cli -- rbac test-unauthorized',
          'npm run cli -- webhook emit ledger',
          'npm run cli -- memory search "PgBouncer lock contention"',
          'npm run cli -- kaggle distill evt-ambient-901'
        ]
      },
      'MonoPulse Autonomous Operations Engine CLI Help'
    );
    return;
  }

  if (sub.startsWith('mcp list')) {
    for (const s of MCP_SERVERS) {
      const tools = MCP_TOOLS.filter((t) => t.serverId === s.id);
      logger.info(
        { serverId: s.id, toolCount: tools.length, tools: tools.map((t) => t.name) },
        `MCP Server: ${s.name}`
      );
    }
    return;
  }

  if (sub.startsWith('rbac test-unauthorized')) {
    const res1 = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9042', reason: 'CLI test' },
      callerRole: 'readonly_analyst'
    });
    logger.warn({ boundaryCheck: res1 }, 'RBAC Boundary Verification');
    return;
  }

  if (sub.startsWith('webhook emit')) {
    const evt = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'CLI emitted P0 PgBouncer pool saturation alert on canary dep-9042'
    });
    logger.info({ eventId: evt.eventId, rca: evt.rootCauseSynthesis }, 'Ambient Event Pre-Computed');
    return;
  }

  if (sub.startsWith('memory search')) {
    const q = args.slice(2).join(' ') || 'PgBouncer connection pool exhaustion';
    const res = await searchPlaybooksBySemanticSimilarity(q, 3);
    logger.info({ query: q, matches: res.matches.length }, 'Semantic Playbook Search Results');
    return;
  }

  if (sub.startsWith('kaggle distill')) {
    const evt = AMBIENT_EVENTS[0];
    const res = await distillTrajectoryViaKaggleGPU({
      trajectoryId: `traj-${evt.eventId}`,
      incidentSummary: evt.incomingPayloadSummary,
      service: evt.service,
      executedTools: evt.autonomousReadOnlyTrace.map((t) => ({
        toolName: t.toolName,
        args: t.args,
        outcomeSummary: t.findingSummary
      }))
    });
    logger.info({ jobId: res.job.jobId, playbookId: res.newPlaybook.id }, 'Kaggle GPU Distillation');
    return;
  }

  if (sub.startsWith('approve')) {
    const out = executeStagedApprovalBlock({
      eventId: AMBIENT_EVENTS[0].eventId,
      callerRole: 'sre_admin'
    });
    logger.info({ eventId: out.event.eventId, success: out.success }, 'Executed 1-Click Approval');
  }
}

main().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'CLI execution error');
  process.exit(1);
});
