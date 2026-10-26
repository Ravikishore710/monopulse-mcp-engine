import { performance } from 'node:perf_hooks';
import { executeMCPToolCall } from './mcpRegistry.ts';
import { ingestAmbientWebhookEvent, executeStagedApprovalBlock } from './ambientOrchestrator.ts';
import {
  acquireEventApprovalLock,
  computeAndRecordWebhookFingerprint,
  getSqliteAuditLogs,
  releaseEventApprovalLock
} from './sqliteEngine.ts';
import {
  persistAmbientEventToSqlite,
  recordQuorumApprovalSignature,
  verifyAuditHashChain
} from './durableLedger.ts';
import { signApprovalToken } from './cryptoSecurity.ts';
import { setSimulationModeActive } from './liveConnectors.ts';
import { SimulationDataService, SimulationDatasetSummary } from './simulationDataService.ts';
import { RBACRole } from '../types/monopulse.ts';

export interface StressTestOptions {
  webhookBurstSize?: number;
  rpcBurstSize?: number;
  competingApprovers?: number;
}

export interface LatencyPercentileTelemetry {
  sampleCount: number;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  webhookP95Ms: number;
  rpcP95Ms: number;
}

export interface SystemLoadStressReport {
  utility: 'SystemLoadStressTest';
  status: 'PASSED' | 'FAILED';
  simulationModeEnforced: boolean;
  durationMs: number;
  totalConcurrentOperations: number;
  throughputOpsPerSec: number;
  responseTimeTelemetry: LatencyPercentileTelemetry;
  webhookBurst: {
    totalFired: number;
    uniqueIngested: number;
    deduplicatedCount: number;
  };
  mcpRpcBurst: {
    totalCalls: number;
    allowedSuccessCount: number;
    hmacSignedMutationSuccessCount: number;
    rbacDeniedCount: number;
    sqlMutationBlockedCount: number;
  };
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
    headHash: string;
    sqliteAuditRowCount: number;
    simulationDataset: SimulationDatasetSummary;
  };
}

function computePercentile(sortedSamples: number[], percentile: number): number {
  if (sortedSamples.length === 0) return 0;
  const idx = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedSamples.length) - 1)
  );
  return Number(sortedSamples[idx].toFixed(2));
}

function summarizeLatencies(
  allSamples: number[],
  webhookSamples: number[],
  rpcSamples: number[]
): LatencyPercentileTelemetry {
  const sortedAll = [...allSamples].sort((a, b) => a - b);
  const sortedWebhooks = [...webhookSamples].sort((a, b) => a - b);
  const sortedRpcs = [...rpcSamples].sort((a, b) => a - b);
  const sum = sortedAll.reduce((acc, v) => acc + v, 0);

  return {
    sampleCount: sortedAll.length,
    minMs: sortedAll.length > 0 ? Number(sortedAll[0].toFixed(2)) : 0,
    avgMs: sortedAll.length > 0 ? Number((sum / sortedAll.length).toFixed(2)) : 0,
    p50Ms: computePercentile(sortedAll, 50),
    p95Ms: computePercentile(sortedAll, 95),
    p99Ms: computePercentile(sortedAll, 99),
    maxMs: sortedAll.length > 0 ? Number(sortedAll[sortedAll.length - 1].toFixed(2)) : 0,
    webhookP95Ms: computePercentile(sortedWebhooks, 95),
    rpcP95Ms: computePercentile(sortedRpcs, 95)
  };
}

export class SystemLoadStressTest {
  /**
   * Generates concurrent multi-source webhook bursts, multi-role MCP RPC calls,
   * and competing approval race conditions to verify system stability, response times,
   * and SHA-256 Merkle audit log integrity under heavy multi-user load.
   */
  static async runStressTest(options: StressTestOptions = {}): Promise<SystemLoadStressReport> {
    const suiteStart = performance.now();
    setSimulationModeActive(true);
    const datasetSummary = SimulationDataService.populateSimulationData();

    const webhookBurstSize = Math.min(48, Math.max(4, options.webhookBurstSize ?? 6));
    const rpcBurstSize = Math.min(64, Math.max(8, options.rpcBurstSize ?? 12));
    const competingApproversCount = Math.min(16, Math.max(2, options.competingApprovers ?? 4));

    const webhookTemplates = [
      {
        source: 'slack.incident.webhook' as const,
        service: 'checkout-ledger-svc' as const,
        channelOrTicket: '#inc-prod-alerts · OPS-4824',
        payloadSummary: '[STRESS-TEST WAVE A] PgBouncer pool saturation 98% on org_hyperion_pay'
      },
      {
        source: 'jira.issue.created' as const,
        service: 'webhook-dispatcher-v2' as const,
        channelOrTicket: 'OPS-4822 · #tier2-customer-escalations',
        payloadSummary: '[STRESS-TEST WAVE B] EU & APAC webhook TLS handshake timeout spike'
      },
      {
        source: 'github.canary.alert' as const,
        service: 'auth-token-gateway' as const,
        channelOrTicket: '#deployments-feed · OPS-4825',
        payloadSummary: '[STRESS-TEST WAVE C] Canary dep-9048 JWK cache stampede in eu-central-1'
      }
    ];

    const burstPayloads = Array.from({ length: webhookBurstSize }, (_, idx) => {
      return webhookTemplates[idx % webhookTemplates.length];
    });

    const webhookLatencies: number[] = [];
    const webhookResults = await Promise.all(
      burstPayloads.map(async (payload) => {
        const t0 = performance.now();
        const dedup = computeAndRecordWebhookFingerprint(payload);
        const evt = await ingestAmbientWebhookEvent(payload);
        persistAmbientEventToSqlite({ ...evt, status: evt.approvalState });
        webhookLatencies.push(Math.max(0.2, performance.now() - t0));
        return { dedup, evt };
      })
    );

    const deduplicatedCount = webhookResults.filter((r) => r.dedup.deduplicated).length;
    const uniqueIngested = webhookResults.length - deduplicatedCount;

    const validRollbackArgs = {
      deploy_id: 'dep-9042',
      reason: 'Stress test HMAC-verified canary rollback'
    };
    const signedRollbackToken = signApprovalToken({
      toolName: 'infra_trigger_canary_rollback',
      args: validRollbackArgs
    });

    const validJiraArgs = { ticket_key: 'OPS-4825', new_status: 'Mitigated' };
    const signedJiraToken = signApprovalToken({
      toolName: 'jira_transition_ticket_status',
      args: validJiraArgs
    });

    const baseRpcCatalog: {
      role: RBACRole;
      toolName: string;
      args: Record<string, any>;
      approvalToken?: string;
    }[] = [
      {
        role: 'readonly_analyst',
        toolName: 'sql_execute_readonly_query',
        args: { query: 'SELECT * FROM customer_orgs' }
      },
      {
        role: 'readonly_analyst',
        toolName: 'sql_execute_readonly_query',
        args: { query: 'DROP TABLE deployments' }
      },
      {
        role: 'readonly_analyst',
        toolName: 'infra_trigger_canary_rollback',
        args: { deploy_id: 'dep-9042', reason: 'Unauthorized analyst attempt' }
      },
      {
        role: 'support_tier2',
        toolName: 'jira_get_ticket_context',
        args: { ticket_key: 'OPS-4825' }
      },
      {
        role: 'support_tier2',
        toolName: 'slack_summarize_incident_thread',
        args: { thread_ts: '1761406210.004200' }
      },
      {
        role: 'support_tier2',
        toolName: 'infra_trigger_canary_rollback',
        args: { deploy_id: 'dep-9048', reason: 'Unauthorized support attempt' }
      },
      {
        role: 'eng_lead',
        toolName: 'github_get_pr_diff',
        args: { pr_number: 1849 }
      },
      {
        role: 'eng_lead',
        toolName: 'docs_get_runbook_by_service',
        args: { service: 'checkout-ledger-svc' }
      },
      {
        role: 'sre_admin',
        toolName: 'infra_get_service_error_rate',
        args: { service: 'checkout-ledger-svc' }
      },
      {
        role: 'sre_admin',
        toolName: 'sql_check_replication_lag',
        args: { cluster_name: 'auth-prod-cluster' }
      },
      {
        role: 'sre_admin',
        toolName: 'infra_trigger_canary_rollback',
        args: validRollbackArgs,
        approvalToken: signedRollbackToken
      },
      {
        role: 'sre_admin',
        toolName: 'jira_transition_ticket_status',
        args: validJiraArgs,
        approvalToken: signedJiraToken
      }
    ];

    const rpcTasks = Array.from({ length: rpcBurstSize }, (_, idx) => {
      return baseRpcCatalog[idx % baseRpcCatalog.length];
    });

    const rpcLatencies: number[] = [];
    const rpcOutcomes = await Promise.all(
      rpcTasks.map(async (task) => {
        const t0 = performance.now();
        const out = executeMCPToolCall({
          toolName: task.toolName,
          args: task.args,
          callerRole: task.role,
          approvalToken: task.approvalToken
        });
        rpcLatencies.push(Math.max(0.1, performance.now() - t0));
        return { task, out };
      })
    );

    const allowedSuccessCount = rpcOutcomes.filter((r) => r.out.status === 'SUCCESS').length;
    const hmacSignedMutationSuccessCount = rpcOutcomes.filter(
      (r) => r.out.status === 'SUCCESS' && Boolean(r.task.approvalToken)
    ).length;
    const rbacDeniedCount = rpcOutcomes.filter((r) => r.out.status === 'RBAC_DENIED').length;
    const sqlMutationBlockedCount = rpcOutcomes.filter(
      (r) => r.out.status === 'SQL_MUTATION_BLOCKED'
    ).length;

    const targetRaceEvent = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#sre-war-room · OPS-4824',
      payloadSummary: `[RACE-STRESS-${Date.now()}] Concurrent ${competingApproversCount}-operator approval lock verification`
    });
    persistAmbientEventToSqlite({ ...targetRaceEvent, status: targetRaceEvent.approvalState });

    recordQuorumApprovalSignature({
      eventId: targetRaceEvent.eventId,
      operatorId: 'ravi.kishore',
      callerRole: 'sre_admin'
    });
    const quorum = recordQuorumApprovalSignature({
      eventId: targetRaceEvent.eventId,
      operatorId: 'sre_oncall_dana',
      callerRole: 'sre_admin'
    });

    const competingOperators = Array.from(
      { length: competingApproversCount },
      (_, idx) => `operator_${idx + 1}:sre_admin`
    );

    const approvalLatencies: number[] = [];
    const approvalRaceOutcomes = await Promise.all(
      competingOperators.map(async (operatorTag) => {
        const t0 = performance.now();
        const acquired = acquireEventApprovalLock(targetRaceEvent.eventId, operatorTag);
        if (!acquired) {
          approvalLatencies.push(Math.max(0.1, performance.now() - t0));
          return { operatorTag, acquired: false, executed: false };
        }
        const exec = executeStagedApprovalBlock({
          eventId: targetRaceEvent.eventId,
          callerRole: 'sre_admin'
        });
        if (!exec.success) releaseEventApprovalLock(targetRaceEvent.eventId);
        approvalLatencies.push(Math.max(0.1, performance.now() - t0));
        return { operatorTag, acquired: true, executed: exec.success };
      })
    );

    const winnerCount = approvalRaceOutcomes.filter((o) => o.acquired && o.executed).length;
    const blockedDuplicateCount = approvalRaceOutcomes.filter((o) => !o.acquired).length;

    const chainCheck = verifyAuditHashChain();
    const sqliteAuditRowCount = getSqliteAuditLogs(200).length;
    const durationMs = Math.max(1, Math.round(performance.now() - suiteStart));
    const totalConcurrentOperations =
      burstPayloads.length + rpcTasks.length + competingOperators.length + 2;

    const allSamples = [...webhookLatencies, ...rpcLatencies, ...approvalLatencies];
    const responseTimeTelemetry = summarizeLatencies(allSamples, webhookLatencies, rpcLatencies);

    const passed =
      winnerCount === 1 &&
      blockedDuplicateCount === competingOperators.length - 1 &&
      quorum.quorumMet &&
      rbacDeniedCount >= 2 &&
      sqlMutationBlockedCount >= 1 &&
      hmacSignedMutationSuccessCount >= 1 &&
      chainCheck.valid;

    return {
      utility: 'SystemLoadStressTest',
      status: passed ? 'PASSED' : 'FAILED',
      simulationModeEnforced: true,
      durationMs,
      totalConcurrentOperations,
      throughputOpsPerSec: Math.round((totalConcurrentOperations / durationMs) * 1000),
      responseTimeTelemetry,
      webhookBurst: {
        totalFired: burstPayloads.length,
        uniqueIngested,
        deduplicatedCount
      },
      mcpRpcBurst: {
        totalCalls: rpcTasks.length,
        allowedSuccessCount,
        hmacSignedMutationSuccessCount,
        rbacDeniedCount,
        sqlMutationBlockedCount
      },
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
        headHash: chainCheck.headHash,
        sqliteAuditRowCount,
        simulationDataset: datasetSummary
      }
    };
  }
}
