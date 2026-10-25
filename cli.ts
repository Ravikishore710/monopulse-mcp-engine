#!/usr/bin/env node
/**
 * MonoPulse Standalone Command-Line Interface (CLI)
 * Usage:
 *   npm run cli -- mcp list
 *   npm run cli -- rbac test-unauthorized
 *   npm run cli -- webhook emit ledger
 *   npm run cli -- memory search "PgBouncer lock contention"
 *   npm run cli -- kaggle distill evt-ambient-901
 */

import { MCP_SERVERS, MCP_TOOLS, executeMCPToolCall } from './src/server/mcpRegistry.ts';
import { searchPlaybooksBySemanticSimilarity, distillTrajectoryViaKaggleGPU } from './src/server/memoryEngine.ts';
import { AMBIENT_EVENTS, ingestAmbientWebhookEvent, executeStagedApprovalBlock } from './src/server/ambientOrchestrator.ts';

async function main() {
  const args = process.argv.slice(2);
  const sub = args.join(' ').trim() || 'help';

  if (sub === 'help' || sub === '--help') {
    console.log(`MonoPulse Autonomous Operations Engine CLI
Commands:
  npm run cli -- mcp list
  npm run cli -- rbac test-unauthorized
  npm run cli -- webhook emit ledger
  npm run cli -- memory search "PgBouncer lock contention"
  npm run cli -- kaggle distill evt-ambient-901`);
    return;
  }

  if (sub.startsWith('mcp list')) {
    for (const s of MCP_SERVERS) {
      const tools = MCP_TOOLS.filter((t) => t.serverId === s.id);
      console.log(`\n[${s.id}] ${s.name} (${tools.length} tools)`);
      for (const t of tools) {
        console.log(`  - ${t.name} (${t.isMutation ? 'MUTATION' : 'READ-ONLY'}) roles=[${t.allowedRoles.join(',')}]`);
      }
    }
    return;
  }

  if (sub.startsWith('rbac test-unauthorized')) {
    const res1 = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9042', reason: 'CLI test' },
      callerRole: 'readonly_analyst'
    });
    console.log('RBAC Boundary Check:', JSON.stringify(res1, null, 2));
    return;
  }

  if (sub.startsWith('webhook emit')) {
    const evt = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'CLI emitted P0 PgBouncer pool saturation alert on canary dep-9042'
    });
    console.log('Ambient Event Pre-Computed:', JSON.stringify(evt, null, 2));
    return;
  }

  if (sub.startsWith('memory search')) {
    const q = args.slice(2).join(' ') || 'PgBouncer connection pool exhaustion';
    const res = await searchPlaybooksBySemanticSimilarity(q, 3);
    console.log(JSON.stringify(res, null, 2));
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
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (sub.startsWith('approve')) {
    const out = executeStagedApprovalBlock({
      eventId: AMBIENT_EVENTS[0].eventId,
      callerRole: 'sre_admin'
    });
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
