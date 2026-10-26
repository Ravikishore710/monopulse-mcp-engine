import { SQL_TABLES, JIRA_TICKETS, SLACK_THREADS, GITHUB_PRS } from './sandboxData.ts';
import { executeMCPToolCall } from './mcpRegistry.ts';
import { ingestAmbientWebhookEvent, executeStagedApprovalBlock } from './ambientOrchestrator.ts';
import { acquireEventApprovalLock, computeAndRecordWebhookFingerprint, releaseEventApprovalLock } from './sqliteEngine.ts';
import { persistAmbientEventToSqlite, recordQuorumApprovalSignature, verifyAuditHashChain } from './durableLedger.ts';
import { setSimulationModeActive } from './liveConnectors.ts';
import { RBACRole } from '../types/monopulse.ts';

export interface SimulationDatasetSummary {
  seeded: boolean;
  timestamp: string;
  counts: {
    sqlTables: number;
    totalSqlRows: number;
    jiraTickets: number;
    slackThreads: number;
    totalSlackMessages: number;
    githubPrs: number;
  };
}

export interface LoadTestMetricsReport {
  status: 'PASSED' | 'FAILED';
  simulationModeEnforced: boolean;
  durationMs: number;
  totalConcurrentOperations: number;
  throughputOpsPerSec: number;
  webhookBurst: { totalFired: number; uniqueIngested: number; deduplicatedCount: number };
  mcpRpcBurst: { totalCalls: number; allowedSuccessCount: number; rbacDeniedCount: number; sqlMutationBlockedCount: number };
  approvalRaceConditionTest: {
    eventId: string;
    concurrentApprovers: number;
    winnerCount: number;
    blockedDuplicateCount: number;
    quorumMet: boolean;
    exactlyOneExecutionVerified: boolean;
  };
  stateIntegrity: {
    auditHashChainValid: boolean;
    checkedFrames: number;
    simulationDataset: SimulationDatasetSummary;
  };
}

let simulationSeeded = false;

export class SimulationDataService {
  /**
   * Populates SQL_TABLES, JIRA_TICKETS, SLACK_THREADS, and GITHUB_PRS with diverse,
   * realistic multi-user scenario data when Simulation Mode is enabled.
   */
  static populateSimulationData(): SimulationDatasetSummary {
    if (!simulationSeeded) {
      SQL_TABLES.deployments.rows.push(
        { deploy_id: 'dep-9048', service: 'auth-token-gateway', git_sha: '9b41e02', pr_number: 1849, author: 'ravi.kishore', canary_weight_pct: 50, status: 'ACTIVE_CANARY', deployed_at: '2026-10-26T03:40:00Z' },
        { deploy_id: 'dep-9045', service: 'webhook-dispatcher-v2', git_sha: 'f03d88a', pr_number: 1846, author: 'sre_oncall_dana', canary_weight_pct: 100, status: 'PROMOTED', deployed_at: '2026-10-26T02:15:00Z' },
        { deploy_id: 'dep-9043', service: 'checkout-ledger-svc', git_sha: 'e12c904', pr_number: 1844, author: 'mchen', canary_weight_pct: 0, status: 'ROLLED_BACK', deployed_at: '2026-10-25T21:10:00Z' }
      );

      SQL_TABLES.service_incidents.rows.push(
        { incident_id: 'inc-412', service: 'auth-token-gateway', error_rate_pct: 6.2, p99_latency_ms: 1840, db_pool_exhaustion_pct: 84, jira_key: 'OPS-4825' },
        { incident_id: 'inc-411', service: 'checkout-ledger-svc', error_rate_pct: 9.1, p99_latency_ms: 3120, db_pool_exhaustion_pct: 91, jira_key: 'OPS-4824' }
      );

      SQL_TABLES.customer_orgs.rows.push(
        { org_id: 'org_hyperion_pay', org_name: 'Hyperion Global Payments', sla_tier: 'ENTERPRISE_9999', active_region: 'us-east-1', failed_tx_last_15m: 274 },
        { org_id: 'org_solaris_bank', org_name: 'Solaris Digital Banking', sla_tier: 'ENTERPRISE_9999', active_region: 'eu-central-1', failed_tx_last_15m: 96 },
        { org_id: 'org_nexus_freight', org_name: 'Nexus Autonomous Freight', sla_tier: 'GROWTH_999', active_region: 'ap-southeast-1', failed_tx_last_15m: 41 }
      );

      SQL_TABLES.feature_flags.rows.push(
        { flag_key: 'enable_jwk_zero_downtime_rotation', service: 'auth-token-gateway', enabled: true, rollout_pct: 50, updated_by: 'ravi.kishore' },
        { flag_key: 'circuit_breaker_eu_webhooks_v3', service: 'webhook-dispatcher-v2', enabled: true, rollout_pct: 100, updated_by: 'sre_oncall_dana' }
      );

      SQL_TABLES.db_replication_status.rows.push(
        { replica_node: 'pg-auth-ro-01.eu-central-1', cluster: 'auth-prod-cluster', replication_lag_ms: 1480, active_locks: 29, state: 'DEGRADED' },
        { replica_node: 'pg-webhook-ro-01.ap-southeast-1', cluster: 'webhook-prod-cluster', replication_lag_ms: 95, active_locks: 4, state: 'STREAMING' }
      );

      JIRA_TICKETS.push(
        {
          key: 'OPS-4825',
          summary: 'P0: auth-token-gateway JWK cache stampede & 6.2% 5xx spike in eu-central-1',
          priority: 'P0-Critical',
          status: 'Investigating',
          service: 'auth-token-gateway',
          assignee: 'ravi.kishore',
          reporter: 'sre_oncall_dana',
          created_at: '2026-10-26T03:44:00Z',
          sla_remaining_min: 11,
          root_cause_notes: 'Canary dep-9048 (PR #1849) invalidated Redis JWK TTL keys simultaneously across 24 pods.',
          description: 'Solaris Digital Banking and Vanguard BioLabs experiencing intermittent 401/503 responses during OAuth2 token refresh.'
        },
        {
          key: 'OPS-4824',
          summary: 'P1: Hyperion Global Payments settlement batch lock contention on checkout-ledger-svc',
          priority: 'P1-High',
          status: 'Investigating',
          service: 'checkout-ledger-svc',
          assignee: 'mchen',
          reporter: 'support_lead_maya',
          created_at: '2026-10-26T02:55:00Z',
          sla_remaining_min: 28,
          root_cause_notes: 'Batch reconciliation worker missing SKIP LOCKED clause on high-throughput tenant.',
          description: '274 failed checkout transactions in the last 15 minutes for org_hyperion_pay.'
        },
        {
          key: 'OPS-4822',
          summary: 'P2: ap-southeast-1 outbound webhook retry queue growth on Nexus Freight endpoint',
          priority: 'P2-Medium',
          status: 'Open',
          service: 'webhook-dispatcher-v2',
          assignee: 'alex.analyst',
          reporter: 'support_lead_maya',
          created_at: '2026-10-26T01:20:00Z',
          sla_remaining_min: 115,
          root_cause_notes: '',
          description: 'Observability analyst flagged elevated retry queue depth in ap-southeast-1.'
        }
      );

      SLACK_THREADS[0].messages.push(
        { user: 'ravi.kishore', role: 'sre_admin', ts: '1761406320.004500', text: '[Simulation Seed] Enabled Simulation Mode. Cross-checking `org_hyperion_pay` and `org_acme_global` lock queues before we co-sign canary rollback.' },
        { user: 'alex.analyst', role: 'readonly_analyst', ts: '1761406355.004600', text: 'Confirmed via `sql_execute_readonly_query`: 274 failed tx on Hyperion Global Payments and 98% PgBouncer saturation.' }
      );

      if (!SLACK_THREADS.some((t) => t.channel_id === 'C04DEPLOYS')) {
        SLACK_THREADS.push({
          thread_ts: '1761408100.009100',
          channel_id: 'C04DEPLOYS',
          channel_name: '#deployments-feed',
          topic: 'Automated Canary & ArgoCD Rollout Feed · Multi-User Simulation',
          messages: [
            { user: 'monopulse-mcp-bot', role: 'webhook', ts: '1761408100.009100', text: '[CANARY ALERT] `dep-9048` (`auth-token-gateway`, author `@ravi.kishore`) shifted to 50% traffic in `eu-central-1`. Linked Jira: `OPS-4825`.' },
            { user: 'sre_oncall_dana', role: 'sre_admin', ts: '1761408145.009200', text: 'Monitoring `pg-auth-ro-01.eu-central-1` replication lag (1480ms). Ready to co-sign 2-person quorum if error rate crosses 5%.' },
            { user: 'mchen', role: 'eng_lead', ts: '1761408190.009300', text: 'Reviewed PR #1849 & PR #1842 diffs—staged runbook patch on `RUNBOOK-LEDGER-01`.' }
          ],
          approval_blocks: [
            { block_id: 'blk-sim-9048', event_id: 'evt-ambient-901', summary: 'Staged 1-Click Canary Rollback for dep-9042 & dep-9048 (Simulation Sandbox)', status: 'STAGED', posted_at: '2026-10-26T04:00:00Z' }
          ]
        });
      }

      if (!GITHUB_PRS.some((pr) => pr.pr_number === 1849)) {
        GITHUB_PRS.push({
          pr_number: 1849,
          repo: 'org-internal/auth-token-gateway',
          title: 'feat(auth): rotate JWK signing keys with aggressive Redis cache flush',
          author: 'ravi.kishore',
          branch: 'feat/jwk-cache-flush',
          status: 'merged',
          ci_status: 'failing',
          changed_files: ['src/auth/JwkKeyring.ts', 'src/cache/RedisTokenStore.ts'],
          diff_summary: '@@ -41,2 +41,3 @@ await redis.del("jwk:active:*"); // Unstaggered flush across all regional pods',
          checks: [{ name: 'eu-central-1-canary-probe', status: 'failing', duration_s: 95, log_excerpt: 'HTTP 503 cache stampede on JWK refresh' }],
          comments: []
        });
      }

      simulationSeeded = true;
    }

    return SimulationDataService.getDatasetSummary();
  }

  static getDatasetSummary(): SimulationDatasetSummary {
    const sqlKeys = Object.keys(SQL_TABLES);
    const totalSqlRows = sqlKeys.reduce((acc, k) => acc + SQL_TABLES[k].rows.length, 0);
    const totalSlackMessages = SLACK_THREADS.reduce((acc, t) => acc + t.messages.length, 0);
    return {
      seeded: simulationSeeded,
      timestamp: new Date().toISOString(),
      counts: {
        sqlTables: sqlKeys.length,
        totalSqlRows,
        jiraTickets: JIRA_TICKETS.length,
        slackThreads: SLACK_THREADS.length,
        totalSlackMessages,
        githubPrs: GITHUB_PRS.length
      }
    };
  }

  /**
   * Executes a high-concurrency burst of webhooks, multi-role MCP RPC calls,
   * and competing 1-Click Approvals to verify race-condition safety and state integrity.
   */
  static async runConcurrentLoadTest(): Promise<LoadTestMetricsReport> {
    const startMs = Date.now();
    setSimulationModeActive(true);
    const datasetSummary = SimulationDataService.populateSimulationData();

    const burstPayloads = [
      { source: 'slack.incident.webhook' as const, service: 'checkout-ledger-svc' as const, channelOrTicket: '#inc-prod-alerts · OPS-4824', payloadSummary: '[LOAD-TEST BURST A] PgBouncer pool saturation 98% on org_hyperion_pay' },
      { source: 'slack.incident.webhook' as const, service: 'checkout-ledger-svc' as const, channelOrTicket: '#inc-prod-alerts · OPS-4824', payloadSummary: '[LOAD-TEST BURST A] PgBouncer pool saturation 98% on org_hyperion_pay' },
      { source: 'jira.issue.created' as const, service: 'webhook-dispatcher-v2' as const, channelOrTicket: 'OPS-4822 · #tier2-customer-escalations', payloadSummary: '[LOAD-TEST BURST B] EU & APAC webhook TLS handshake timeout spike' },
      { source: 'jira.issue.created' as const, service: 'webhook-dispatcher-v2' as const, channelOrTicket: 'OPS-4822 · #tier2-customer-escalations', payloadSummary: '[LOAD-TEST BURST B] EU & APAC webhook TLS handshake timeout spike' },
      { source: 'github.canary.alert' as const, service: 'auth-token-gateway' as const, channelOrTicket: '#deployments-feed · OPS-4825', payloadSummary: '[LOAD-TEST BURST C] Canary dep-9048 JWK cache stampede in eu-central-1' },
      { source: 'github.canary.alert' as const, service: 'auth-token-gateway' as const, channelOrTicket: '#deployments-feed · OPS-4825', payloadSummary: '[LOAD-TEST BURST C] Canary dep-9048 JWK cache stampede in eu-central-1' }
    ];

    const webhookResults = await Promise.all(
      burstPayloads.map(async (p) => {
        const dedup = computeAndRecordWebhookFingerprint(p);
        const evt = await ingestAmbientWebhookEvent(p);
        persistAmbientEventToSqlite({ ...evt, status: evt.approvalState });
        return { dedup, evt };
      })
    );

    const deduplicatedCount = webhookResults.filter((r) => r.dedup.deduplicated).length;
    const uniqueIngested = webhookResults.length - deduplicatedCount;

    const rpcTasks: { role: RBACRole; toolName: string; args: Record<string, any> }[] = [
      { role: 'readonly_analyst', toolName: 'sql_execute_readonly_query', args: { query: 'SELECT * FROM customer_orgs' } },
      { role: 'readonly_analyst', toolName: 'sql_execute_readonly_query', args: { query: 'DROP TABLE deployments' } },
      { role: 'readonly_analyst', toolName: 'infra_trigger_canary_rollback', args: { deploy_id: 'dep-9042', reason: 'Analyst test' } },
      { role: 'support_tier2', toolName: 'jira_get_ticket_context', args: { ticket_key: 'OPS-4825' } },
      { role: 'support_tier2', toolName: 'slack_summarize_incident_thread', args: { thread_ts: '1761406210.004200' } },
      { role: 'support_tier2', toolName: 'infra_trigger_canary_rollback', args: { deploy_id: 'dep-9048', reason: 'Support test' } },
      { role: 'eng_lead', toolName: 'github_get_pr_diff', args: { pr_number: 1849 } },
      { role: 'eng_lead', toolName: 'docs_get_runbook_by_service', args: { service: 'checkout-ledger-svc' } },
      { role: 'sre_admin', toolName: 'infra_get_service_error_rate', args: { service: 'checkout-ledger-svc' } },
      { role: 'sre_admin', toolName: 'sql_check_replication_lag', args: { cluster_name: 'auth-prod-cluster' } }
    ];

    const rpcOutcomes = await Promise.all(
      rpcTasks.map((task) => Promise.resolve(executeMCPToolCall({ toolName: task.toolName, args: task.args, callerRole: task.role })))
    );

    const allowedSuccessCount = rpcOutcomes.filter((o) => o.status === 'SUCCESS').length;
    const rbacDeniedCount = rpcOutcomes.filter((o) => o.status === 'RBAC_DENIED').length;
    const sqlMutationBlockedCount = rpcOutcomes.filter((o) => o.status === 'SQL_MUTATION_BLOCKED').length;

    const targetRaceEvent = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#sre-war-room · OPS-4824',
      payloadSummary: `[RACE-TEST-${Date.now()}] Concurrent 4-operator approval lock verification`
    });
    persistAmbientEventToSqlite({ ...targetRaceEvent, status: targetRaceEvent.approvalState });

    recordQuorumApprovalSignature({ eventId: targetRaceEvent.eventId, operatorId: 'ravi.kishore', callerRole: 'sre_admin' });
    const quorum = recordQuorumApprovalSignature({ eventId: targetRaceEvent.eventId, operatorId: 'sre_oncall_dana', callerRole: 'sre_admin' });

    const competingOperators = ['ravi.kishore:sre_admin', 'sre_oncall_dana:sre_admin', 'mchen:sre_admin_override', 'oncall_secondary:sre_admin'];

    const approvalRaceOutcomes = await Promise.all(
      competingOperators.map(async (operatorTag) => {
        const acquired = acquireEventApprovalLock(targetRaceEvent.eventId, operatorTag);
        if (!acquired) return { operatorTag, acquired: false, executed: false };
        const exec = executeStagedApprovalBlock({ eventId: targetRaceEvent.eventId, callerRole: 'sre_admin' });
        if (!exec.success) releaseEventApprovalLock(targetRaceEvent.eventId);
        return { operatorTag, acquired: true, executed: exec.success };
      })
    );

    const winnerCount = approvalRaceOutcomes.filter((o) => o.acquired && o.executed).length;
    const blockedDuplicateCount = approvalRaceOutcomes.filter((o) => !o.acquired).length;

    const chainCheck = verifyAuditHashChain();
    const durationMs = Math.max(1, Date.now() - startMs);
    const totalConcurrentOperations = burstPayloads.length + rpcTasks.length + competingOperators.length + 2;

    const passed =
      winnerCount === 1 &&
      blockedDuplicateCount === competingOperators.length - 1 &&
      quorum.quorumMet &&
      rbacDeniedCount >= 2 &&
      sqlMutationBlockedCount >= 1 &&
      chainCheck.valid;

    return {
      status: passed ? 'PASSED' : 'FAILED',
      simulationModeEnforced: true,
      durationMs,
      totalConcurrentOperations,
      throughputOpsPerSec: Math.round((totalConcurrentOperations / durationMs) * 1000),
      webhookBurst: { totalFired: burstPayloads.length, uniqueIngested, deduplicatedCount },
      mcpRpcBurst: { totalCalls: rpcTasks.length, allowedSuccessCount, rbacDeniedCount, sqlMutationBlockedCount },
      approvalRaceConditionTest: {
        eventId: targetRaceEvent.eventId,
        concurrentApprovers: competingOperators.length,
        winnerCount,
        blockedDuplicateCount,
        quorumMet: quorum.quorumMet,
        exactlyOneExecutionVerified: winnerCount === 1
      },
      stateIntegrity: {
        auditHashChainValid: chainCheck.valid,
        checkedFrames: chainCheck.verifiedRows,
        simulationDataset: datasetSummary
      }
    };
  }
}
