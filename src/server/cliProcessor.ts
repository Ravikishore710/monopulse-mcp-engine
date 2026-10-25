import {
  MCP_SERVERS,
  MCP_TOOLS,
  executeMCPToolCall,
  RBACRole
} from './mcpRegistry.ts';
import {
  AMBIENT_EVENTS,
  ingestAmbientWebhookEvent,
  executeStagedApprovalBlock
} from './ambientOrchestrator.ts';
import {
  searchPlaybooksBySemanticSimilarity,
  distillTrajectoryViaKaggleGPU
} from './memoryEngine.ts';

export async function processCliCommand(
  rawCmdInput: string,
  callerRole: RBACRole
): Promise<{ command: string; exitCode: number; output: string }> {
  const rawCmd = rawCmdInput.trim();

  if (rawCmd === 'help' || rawCmd === 'monopulse help') {
    return {
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
    };
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
    return { command: rawCmd, exitCode: 0, output: lines };
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
    return {
      command: rawCmd,
      exitCode: 0,
      output: `[TEST 1: Privilege Escalation Attempt by 'readonly_analyst']\nStatus: ${r1.status} (HTTP ${r1.httpCode})\nJSON-RPC Error: ${JSON.stringify(r1.error, null, 2)}\n\n[TEST 2: Destructive SQL DML Injection on 'sql-ops-mcp']\nStatus: ${r2.status} (HTTP ${r2.httpCode})\nJSON-RPC Error: ${JSON.stringify(r2.error, null, 2)}`
    };
  }

  if (rawCmd.startsWith('monopulse mcp call')) {
    const parts = rawCmd.replace('monopulse mcp call', '').trim();
    const firstSpace = parts.indexOf(' ');
    const toolName = firstSpace === -1 ? parts : parts.slice(0, firstSpace).trim();
    const rawJson =
      firstSpace === -1 ? '{}' : parts.slice(firstSpace + 1).trim().replace(/^'|'$/g, '');
    const parsedArgs = JSON.parse(rawJson);
    const rpc = executeMCPToolCall({ toolName, args: parsedArgs, callerRole });
    return {
      command: rawCmd,
      exitCode: rpc.status === 'SUCCESS' ? 0 : 1,
      output: JSON.stringify(rpc, null, 2)
    };
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
    return {
      command: rawCmd,
      exitCode: 0,
      output: `Ambient Event Ingested & Pre-Computed in ${evt.precomputeLatencyMs}ms\nEvent ID: ${evt.eventId}\nMatched Playbook: ${evt.matchedPlaybook?.id}\nRoot Cause: ${evt.rootCauseSynthesis}`
    };
  }

  if (rawCmd.startsWith('monopulse approve')) {
    const targetId = rawCmd.replace('monopulse approve', '').trim() || AMBIENT_EVENTS[0]?.eventId;
    const result = executeStagedApprovalBlock({ eventId: targetId, callerRole });
    return {
      command: rawCmd,
      exitCode: result.success ? 0 : 1,
      output: JSON.stringify(result, null, 2)
    };
  }

  if (rawCmd.startsWith('monopulse memory search')) {
    const query =
      rawCmd.replace('monopulse memory search', '').trim().replace(/^"|"$|^'|'$/g, '') ||
      'PgBouncer connection pool exhaustion on checkout-ledger-svc';
    const searchRes = await searchPlaybooksBySemanticSimilarity(query, 3);
    return {
      command: rawCmd,
      exitCode: 0,
      output: JSON.stringify(searchRes, null, 2)
    };
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
    return {
      command: rawCmd,
      exitCode: 0,
      output: JSON.stringify(distillRes.job, null, 2)
    };
  }

  return {
    command: rawCmd,
    exitCode: 1,
    output: `Unknown command '${rawCmd}'. Type 'monopulse help' for available commands.`
  };
}
