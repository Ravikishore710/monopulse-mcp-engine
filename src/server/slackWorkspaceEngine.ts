import { Router } from 'express';
import { RBACRole } from '../types/monopulse.ts';
import { SLACK_THREADS } from './sandboxData.ts';
import { AMBIENT_EVENTS, executeStagedApprovalBlock, ingestAmbientWebhookEvent } from './ambientOrchestrator.ts';
import { executeMCPToolCall } from './mcpRegistry.ts';
import { acquireEventApprovalLock, releaseEventApprovalLock } from './sqliteEngine.ts';
import { persistAmbientEventToSqlite, recordQuorumApprovalSignature } from './durableLedger.ts';
import { verifyLiveExternalConnectors } from './liveConnectors.ts';
import { broadcastSseEvent } from './observabilityEngine.ts';
import { SlackMessageCreateSchema } from './schemas/httpSchemas.ts';

export interface SlackDummyUser {
  id: string;
  handle: string;
  displayName: string;
  title: string;
  role: RBACRole | 'webhook';
  avatarInitials: string;
  status: 'online' | 'busy' | 'bot';
}

export const SLACK_DUMMY_USERS: SlackDummyUser[] = [
  {
    id: 'U01RAVI',
    handle: 'ravi.kishore',
    displayName: 'Ravi Kishore',
    title: 'Principal SRE & Incident Commander',
    role: 'sre_admin',
    avatarInitials: 'RK',
    status: 'online'
  },
  {
    id: 'U02DANA',
    handle: 'sre_oncall_dana',
    displayName: 'Dana Lin',
    title: 'Primary On-Call SRE',
    role: 'sre_admin',
    avatarInitials: 'DL',
    status: 'online'
  },
  {
    id: 'U03MCHEN',
    handle: 'mchen',
    displayName: 'Marcus Chen',
    title: 'Staff Engineer · Ledger Core',
    role: 'eng_lead',
    avatarInitials: 'MC',
    status: 'online'
  },
  {
    id: 'U04MAYA',
    handle: 'support_lead_maya',
    displayName: 'Maya Patel',
    title: 'Tier-2 Customer Escalations Lead',
    role: 'support_tier2',
    avatarInitials: 'MP',
    status: 'online'
  },
  {
    id: 'U05ALEX',
    handle: 'alex.analyst',
    displayName: 'Alex Rivera',
    title: 'Observability & FinOps Analyst',
    role: 'readonly_analyst',
    avatarInitials: 'AR',
    status: 'online'
  },
  {
    id: 'U00MONOPULSE',
    handle: 'monopulse-mcp-bot',
    displayName: 'MonoPulse Ambient Bot',
    title: 'Autonomous Pre-Compute & 1-Click Approval App',
    role: 'webhook',
    avatarInitials: 'MP',
    status: 'bot'
  }
];

function ensureExtraSlackChannelsSeeded(): void {
  if (!SLACK_THREADS.some((t) => t.channel_id === 'C04WARROOM')) {
    SLACK_THREADS.push({
      thread_ts: '1761407000.008100',
      channel_id: 'C04WARROOM',
      channel_name: '#sre-war-room',
      topic: 'Multi-Operator Incident Command · 2-Person Quorum & Canary Rollback',
      messages: [
        {
          user: 'ravi.kishore',
          role: 'sre_admin',
          ts: '1761407000.008100',
          text: 'War room open for OPS-4821 (`checkout-ledger-svc`). @sre_oncall_dana and I are on-call for 2-person quorum sign-off.'
        },
        {
          user: 'alex.analyst',
          role: 'readonly_analyst',
          ts: '1761407035.008200',
          text: 'Running read-only SQL checks on `pg-ledger-ro-01.us-east-1`—seeing 47 active row locks and 4120ms WAL replication lag.'
        }
      ],
      approval_blocks: []
    });
  }
}

export function getSlackWorkspaceSnapshot() {
  ensureExtraSlackChannelsSeeded();
  const threadsWithSyncedBlocks = SLACK_THREADS.map((thread) => {
    const linkedEvents = AMBIENT_EVENTS.filter((evt) =>
      evt.channelOrTicket.toLowerCase().includes(thread.channel_name.toLowerCase())
    );
    return {
      ...thread,
      linkedAmbientEvents: linkedEvents.map((e) => ({
        eventId: e.eventId,
        service: e.service,
        summary: e.incomingPayloadSummary,
        rootCauseSynthesis: e.rootCauseSynthesis,
        approvalState: e.approvalState,
        approvedByRole: e.approvedByRole,
        approvalToken: e.approvalToken,
        precomputeLatencyMs: e.precomputeLatencyMs,
        stagedMutations: e.stagedMutations
      }))
    };
  });

  return {
    workspaceName: 'MonoPulse Production Workspace (Simulated Slack Grid)',
    workspaceDomain: 'monopulse-prod.slack.com',
    activeUsersCount: SLACK_DUMMY_USERS.length,
    users: SLACK_DUMMY_USERS,
    threads: threadsWithSyncedBlocks
  };
}

export function createSlackWorkspaceRouter(): Router {
  const router = Router();

  router.get('/api/slack/workspace', (_req, res) => {
    res.json(getSlackWorkspaceSnapshot());
  });

  router.post('/api/slack/messages', async (req, res) => {
    ensureExtraSlackChannelsSeeded();
    const parsed = SlackMessageCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
      return;
    }
    const { channelId, userHandle, text, triggerAmbientPrecompute, service } = parsed.data;

    const userObj = SLACK_DUMMY_USERS.find((u) => u.handle === userHandle) || SLACK_DUMMY_USERS[0];
    const thread = SLACK_THREADS.find((t) => t.channel_id === channelId) || SLACK_THREADS[0];
    const ts = `${Math.floor(Date.now() / 1000)}.${Math.floor(100000 + Math.random() * 899999)}`;

    const newMsg = {
      user: userObj.handle,
      role: userObj.role,
      ts,
      text
    };
    thread.messages.push(newMsg);

    let ambientEvent = null;
    const shouldPrecompute =
      Boolean(triggerAmbientPrecompute) ||
      /\[FIRING|P0|P1|5xx|ETIMEDOUT|exhaustion|rollback/i.test(newMsg.text);

    if (shouldPrecompute) {
      ambientEvent = await ingestAmbientWebhookEvent({
        source: 'slack.incident.webhook',
        service: service === 'webhook-dispatcher-v2' ? 'webhook-dispatcher-v2' : 'checkout-ledger-svc',
        channelOrTicket: `${thread.channel_name} · OPS-4821`,
        payloadSummary: newMsg.text
      });
      persistAmbientEventToSqlite({ ...ambientEvent, status: ambientEvent.approvalState });

      thread.messages.push({
        user: 'monopulse-mcp-bot',
        role: 'webhook',
        ts: `${Math.floor(Date.now() / 1000) + 1}.000100`,
        text: `[AMBIENT PRE-COMPUTE COMPLETE in ${ambientEvent.precomputeLatencyMs}ms · Event ${ambientEvent.eventId}] ${ambientEvent.rootCauseSynthesis} — 1-Click Approval Block staged (${ambientEvent.stagedMutations.length} mutations).`
      });
    }

    broadcastSseEvent('slack.message.posted', {
      channelId: thread.channel_id,
      user: userObj.handle,
      ambientEventId: ambientEvent?.eventId || null
    });

    res.status(201).json({
      status: 'MESSAGE_POSTED',
      message: newMsg,
      ambientEventTriggered: Boolean(ambientEvent),
      ambientEvent,
      workspace: getSlackWorkspaceSnapshot()
    });
  });

  // Multi-User Real-World Scenario & Concurrency Verification Runner
  router.post('/api/slack/simulate-multiuser', async (_req, res) => {
    ensureExtraSlackChannelsSeeded();
    const steps: {
      step: number;
      actor: string;
      role: string;
      action: string;
      expectedBehavior: string;
      actualOutcome: string;
      passed: boolean;
    }[] = [];

    // Step 1: Maya (support_tier2) posts an incident escalation in #inc-prod-alerts -> triggers Ambient Pre-compute
    const incidentEvent = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary:
        '[MULTI-USER TEST] @support_lead_maya escalated P0 checkout-ledger-svc 5xx spike (14.8%) from #tier2-customer-escalations.'
    });
    persistAmbientEventToSqlite({ ...incidentEvent, status: incidentEvent.approvalState });
    SLACK_THREADS[0].messages.push({
      user: 'support_lead_maya',
      role: 'support_tier2',
      ts: `${Math.floor(Date.now() / 1000)}.101000`,
      text: `[Escalation] Enterprise merchants reporting HTTP 503 on checkout-ledger-svc. Triggered MonoPulse Event ${incidentEvent.eventId}.`
    });
    steps.push({
      step: 1,
      actor: '@support_lead_maya (Maya Patel)',
      role: 'support_tier2',
      action: 'Post P0 escalation in #inc-prod-alerts & trigger Ambient Pre-Computation',
      expectedBehavior: 'Pre-compute read-only diagnostics & stage 1-Click Block Kit card',
      actualOutcome: `Created ${incidentEvent.eventId} (${incidentEvent.autonomousReadOnlyTrace.length} read-only tools in ${incidentEvent.precomputeLatencyMs}ms)`,
      passed: incidentEvent.approvalState === 'STAGED_1CLICK_READY'
    });

    // Step 2: Alex (readonly_analyst) runs a read-only SQL query (ALLOWED) then attempts 1-Click Rollback (BLOCKED by RBAC)
    const alexRead = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT replica_node, replication_lag_ms, state FROM db_replication_status' },
      callerRole: 'readonly_analyst'
    });
    const alexRollbackAttempt = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: {
        deploy_id: 'dep-9042',
        reason: 'Unauthorized attempt by analyst'
      },
      callerRole: 'readonly_analyst',
      approvalToken: incidentEvent.approvalToken
    });
    steps.push({
      step: 2,
      actor: '@alex.analyst (Alex Rivera)',
      role: 'readonly_analyst',
      action: 'Run read-only SQL telemetry + attempt unauthorized 1-Click Canary Rollback in Slack',
      expectedBehavior: 'Allow SELECT query; block canary rollback with RBAC_DENIED',
      actualOutcome: `SQL Read=${alexRead.status} · Canary Rollback=${alexRollbackAttempt.status}`,
      passed: alexRead.status === 'SUCCESS' && alexRollbackAttempt.status === 'RBAC_DENIED'
    });

    // Step 3: Marcus Chen (eng_lead) inspects GitHub PR #1842 & updates Jira RCA (ALLOWED for eng_lead)
    const mchenPrDiff = executeMCPToolCall({
      toolName: 'github_get_pr_diff',
      args: { pr_number: 1842 },
      callerRole: 'eng_lead'
    });
    steps.push({
      step: 3,
      actor: '@mchen (Marcus Chen)',
      role: 'eng_lead',
      action: 'Inspect PR #1842 diff & verify FOR UPDATE lock regression',
      expectedBehavior: 'Allow eng_lead to inspect PR #1842 diff',
      actualOutcome: `github_get_pr_diff=${mchenPrDiff.status}`,
      passed: mchenPrDiff.status === 'SUCCESS'
    });

    // Step 4: Two-Person Quorum Sign-Off by @sre_oncall_dana and @ravi.kishore
    recordQuorumApprovalSignature({
      eventId: incidentEvent.eventId,
      operatorId: 'sre_oncall_dana',
      callerRole: 'sre_admin'
    });
    const quorumFinal = recordQuorumApprovalSignature({
      eventId: incidentEvent.eventId,
      operatorId: 'ravi.kishore',
      callerRole: 'sre_admin'
    });
    steps.push({
      step: 4,
      actor: '@sre_oncall_dana + @ravi.kishore',
      role: 'sre_admin (2 Distinct Operators)',
      action: 'Co-sign M-of-N (2-of-2) Production Quorum on Slack Approval Block',
      expectedBehavior: 'Quorum satisfied only after 2 distinct SRE operators sign',
      actualOutcome: `Signers=${quorumFinal.signers.join(', ')} · QuorumMet=${quorumFinal.quorumMet}`,
      passed: quorumFinal.quorumMet && quorumFinal.signaturesCollected >= 2
    });

    // Step 5: Concurrent Double-Click Simulation (Ravi and Dana click Approve at the exact same millisecond)
    const lockRavi = acquireEventApprovalLock(incidentEvent.eventId, 'ravi.kishore:sre_admin');
    const lockDanaDuplicate = acquireEventApprovalLock(incidentEvent.eventId, 'sre_oncall_dana:sre_admin');
    let executionSuccess = false;
    if (lockRavi) {
      const execOutcome = executeStagedApprovalBlock({
        eventId: incidentEvent.eventId,
        callerRole: 'sre_admin'
      });
      executionSuccess = execOutcome.success;
      if (!execOutcome.success) releaseEventApprovalLock(incidentEvent.eventId);
    }

    steps.push({
      step: 5,
      actor: '@ravi.kishore vs @sre_oncall_dana (Concurrent Click)',
      role: 'sre_admin',
      action: 'Simultaneous 1-Click Approval race condition test on SQLite event_approval_locks',
      expectedBehavior: 'First click executes (200 OK); concurrent second click is blocked (409 Conflict)',
      actualOutcome: `RaviLockAcquired=${lockRavi} (Executed=${executionSuccess}) · DanaDuplicateLockAcquired=${lockDanaDuplicate} (Blocked Duplicate)`,
      passed: lockRavi === true && lockDanaDuplicate === false && executionSuccess === true
    });

    // Step 6: Live External Connector Verification (GitHub + Jira Cloud)
    const rawConnectors = await verifyLiveExternalConnectors();
    const liveConnectors = {
      github: {
        ...rawConnectors.github,
        status: rawConnectors.github.reachable ? `HTTP ${rawConnectors.github.statusCode} LIVE` : 'FALLBACK'
      },
      jira: {
        ...rawConnectors.jira,
        status: rawConnectors.jira.reachable ? `HTTP ${rawConnectors.jira.statusCode} LIVE` : 'FALLBACK'
      }
    };

    broadcastSseEvent('approval.executed', {
      eventId: incidentEvent.eventId,
      callerRole: 'sre_admin',
      success: true
    });

    res.json({
      scenarioName: '5-User Concurrent Incident Response & Slack Block Kit Verification',
      allStepsPassed: steps.every((s) => s.passed),
      testedEventId: incidentEvent.eventId,
      steps,
      liveExternalConnectors: liveConnectors,
      workspace: getSlackWorkspaceSnapshot()
    });
  });

  return router;
}
