import { GoogleGenAI } from '@google/genai';
import { executeMCPToolCall, RBACRole } from './mcpRegistry.ts';
import { REDIS_TIER1_STORE, searchPlaybooksBySemanticSimilarity } from './memoryEngine.ts';
import { signApprovalToken } from './cryptoSecurity.ts';

const getGenAI = () => {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
};

export interface StagedMutationAction {
  id: string;
  serverId: string;
  toolName: string;
  description: string;
  requiredRole: RBACRole;
  args: Record<string, any>;
  status: 'STAGED_FOR_1CLICK' | 'EXECUTED' | 'FAILED';
  executionResult?: any;
}

export interface AmbientEventRecord {
  eventId: string;
  source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
  channelOrTicket: string;
  service: string;
  incomingPayloadSummary: string;
  receivedAt: string;
  precomputeLatencyMs: number;
  perceivedUserWaitMs: number;
  matchedPlaybook: {
    id: string;
    title: string;
    cosineSimilarity: number;
    stepReductionPct: number;
  } | null;
  injectedSystemPrompt: string;
  autonomousReadOnlyTrace: {
    step: number;
    serverId: string;
    toolName: string;
    args: Record<string, any>;
    latencyMs: number;
    findingSummary: string;
  }[];
  rootCauseSynthesis: string;
  approvalToken: string;
  approvalState: 'STAGED_1CLICK_READY' | 'APPROVED_AND_EXECUTED' | 'EDITED_AND_EXECUTED';
  stagedMutations: StagedMutationAction[];
  approvedByRole?: RBACRole;
  approvedAt?: string;
}

export const AMBIENT_EVENTS: AmbientEventRecord[] = [
  {
    eventId: 'evt-ambient-901',
    source: 'slack.incident.webhook',
    channelOrTicket: '#inc-prod-alerts · OPS-4821',
    service: 'checkout-ledger-svc',
    incomingPayloadSummary:
      '[FIRING: P0] checkout-ledger-svc HTTP 5xx error rate is 14.8% in us-east-1; PgBouncer pool saturation at 98% after canary dep-9042.',
    receivedAt: '2026-10-25T15:22:01Z',
    precomputeLatencyMs: 1640,
    perceivedUserWaitMs: 0,
    matchedPlaybook: {
      id: 'PB-LEDGER-CANARY-01',
      title: 'Playbook: PgBouncer Pool Saturation via Unbounded FOR UPDATE Canary',
      cosineSimilarity: 0.9684,
      stepReductionPct: 37.5
    },
    injectedSystemPrompt: `You are MonoPulse, an Autonomous Internal Operations Monoagent.
EXECUTION MODE: AMBIENT_BACKGROUND_PRECOMPUTE (Zero synchronous chat questions allowed).
<!-- DYNAMICALLY INJECTED PLAYBOOK: PB-LEDGER-CANARY-01 (Cosine Similarity: 0.9684) -->
- Skip exploratory schema discovery. Query active canary deployments on checkout-ledger-svc.
- Inspect GitHub PR #1842 diff for unbounded SELECT ... FOR UPDATE locks.
- Stage 1-Click Approval Block for canary rollback + Jira mitigation.`,
    autonomousReadOnlyTrace: [
      {
        step: 1,
        serverId: 'sql-ops-mcp',
        toolName: 'sql_execute_readonly_query',
        args: {
          query:
            "SELECT deploy_id, service, git_sha, pr_number, canary_weight_pct, status FROM deployments WHERE service = 'checkout-ledger-svc'",
          row_limit: 5
        },
        latencyMs: 18,
        findingSummary:
          'Identified active canary dep-9042 (git_sha=a8f31c9, PR #1842) serving 25% traffic.'
      },
      {
        step: 2,
        serverId: 'github-mcp',
        toolName: 'github_get_pr_diff',
        args: { pr_number: 1842 },
        latencyMs: 24,
        findingSummary:
          'PR #1842 replaced bounded LIMIT 250 query with unbounded SELECT ... FOR UPDATE in LedgerRepository.ts.'
      },
      {
        step: 3,
        serverId: 'infra-mcp',
        toolName: 'infra_fetch_pod_logs',
        args: { service: 'checkout-ledger-svc' },
        latencyMs: 15,
        findingSummary:
          'Confirmed LockWaitTimeout on relation ledger_entries (git_sha=a8f31c9) starving PgBouncer pool.'
      },
      {
        step: 4,
        serverId: 'slack-mcp',
        toolName: 'slack_post_approval_block',
        args: {
          thread_ts: '1761406210.004200',
          event_id: 'evt-ambient-901',
          summary_markdown:
            'Pre-computed RCA: Canary dep-9042 (PR #1842) introduced unbounded FOR UPDATE locks.'
        },
        latencyMs: 12,
        findingSummary: 'Posted silent 1-Click Approve/Edit block into #inc-prod-alerts thread.'
      }
    ],
    rootCauseSynthesis:
      'Canary deployment dep-9042 (commit a8f31c9, PR #1842 by @mchen) replaced the bounded batch query in LedgerRepository.ts with an unbounded SELECT ... FOR UPDATE without SKIP LOCKED, exhausting 98% of PgBouncer connections and causing a 14.8% HTTP 5xx spike.',
    approvalToken: 'appr_sig_9042_ledger_rb',
    approvalState: 'STAGED_1CLICK_READY',
    stagedMutations: [
      {
        id: 'mut-1',
        serverId: 'infra-mcp',
        toolName: 'infra_trigger_canary_rollback',
        description: 'Drain 25% canary traffic from dep-9042 and restore 100% stable routing',
        requiredRole: 'sre_admin',
        args: {
          deploy_id: 'dep-9042',
          reason: 'Rollback PR #1842 (a8f31c9) due to unbounded FOR UPDATE PgBouncer pool exhaustion'
        },
        status: 'STAGED_FOR_1CLICK'
      },
      {
        id: 'mut-2',
        serverId: 'jira-mcp',
        toolName: 'jira_transition_ticket_status',
        description: 'Transition Jira incident OPS-4821 from Investigating to Mitigated',
        requiredRole: 'support_tier2',
        args: { ticket_key: 'OPS-4821', new_status: 'Mitigated' },
        status: 'STAGED_FOR_1CLICK'
      },
      {
        id: 'mut-3',
        serverId: 'slack-mcp',
        toolName: 'slack_broadcast_resolution',
        description: 'Broadcast verified canary rollback confirmation to #inc-prod-alerts',
        requiredRole: 'support_tier2',
        args: {
          channel_name: '#inc-prod-alerts',
          resolution_message:
            'Rolled back canary dep-9042 (PR #1842). PgBouncer pool saturation cleared and HTTP 5xx rate recovered to 0.18%.'
        },
        status: 'STAGED_FOR_1CLICK'
      }
    ]
  },
  {
    eventId: 'evt-ambient-902',
    source: 'jira.issue.created',
    channelOrTicket: 'OPS-4819 · #tier2-customer-escalations',
    service: 'webhook-dispatcher-v2',
    incomingPayloadSummary:
      'Jira OPS-4819 created: Vanguard BioLabs (eu-central-1) experiencing intermittent webhook delivery drops with ETIMEDOUT during TLS handshakes.',
    receivedAt: '2026-10-25T14:50:02Z',
    precomputeLatencyMs: 1420,
    perceivedUserWaitMs: 0,
    matchedPlaybook: {
      id: 'PB-WEBHOOK-TLS-02',
      title: 'Playbook: Cross-Region Webhook TLS Handshake ETIMEDOUT Regression',
      cosineSimilarity: 0.9412,
      stepReductionPct: 42.8
    },
    injectedSystemPrompt: `You are MonoPulse, an Autonomous Internal Operations Monoagent.
EXECUTION MODE: AMBIENT_BACKGROUND_PRECOMPUTE.
<!-- DYNAMICALLY INJECTED PLAYBOOK: PB-WEBHOOK-TLS-02 (Cosine Similarity: 0.9412) -->
- Directly inspect git blame on src/http/WebhookClient.ts and PR #1835 diff.`,
    autonomousReadOnlyTrace: [
      {
        step: 1,
        serverId: 'github-mcp',
        toolName: 'github_blame_file_range',
        args: { file_path: 'src/http/WebhookClient.ts' },
        latencyMs: 19,
        findingSummary:
          'Commit c4190ab (PR #1835 by @arivera) reduced tlsHandshakeTimeoutMs from 2500ms to 400ms.'
      },
      {
        step: 2,
        serverId: 'docs-mcp',
        toolName: 'docs_get_runbook_by_service',
        args: { service: 'webhook-dispatcher-v2' },
        latencyMs: 11,
        findingSummary:
          'Runbook RUNBOOK-WEBHOOK-04 specifies 1500ms minimum safe cross-region TLS handshake threshold.'
      }
    ],
    rootCauseSynthesis:
      'Commit c4190ab (PR #1835) tightened tlsHandshakeTimeoutMs from 2500ms to 400ms in WebhookClient.ts, violating the 1500ms cross-Atlantic minimum required for eu-central-1 enterprise endpoints.',
    approvalToken: 'appr_sig_4819_webhook_tls',
    approvalState: 'STAGED_1CLICK_READY',
    stagedMutations: [
      {
        id: 'mut-201',
        serverId: 'github-mcp',
        toolName: 'github_post_pr_review_comment',
        description: 'Annotate PR #1835 with cross-region TLS handshake regression analysis',
        requiredRole: 'eng_lead',
        args: {
          pr_number: 1835,
          comment_body:
            'Automated RCA (OPS-4819): Lowering `tlsHandshakeTimeoutMs` to 400ms breaks `eu-central-1` TLS handshakes (minimum runbook threshold: 1500ms).'
        },
        status: 'STAGED_FOR_1CLICK'
      },
      {
        id: 'mut-202',
        serverId: 'jira-mcp',
        toolName: 'jira_append_root_cause_field',
        description: 'Write verified commit SHA c4190ab and PR #1835 into OPS-4819 RCA notes',
        requiredRole: 'eng_lead',
        args: {
          ticket_key: 'OPS-4819',
          root_cause_notes: 'Regression in PR #1835 (commit c4190ab): tlsHandshakeTimeoutMs reduced to 400ms.'
        },
        status: 'STAGED_FOR_1CLICK'
      }
    ]
  }
];

export async function ingestAmbientWebhookEvent(params: {
  source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
  service: 'checkout-ledger-svc' | 'webhook-dispatcher-v2' | 'auth-token-gateway';
  channelOrTicket: string;
  payloadSummary: string;
}): Promise<AmbientEventRecord> {
  const start = Date.now();
  const eventId = `evt-ambient-${Date.now().toString().slice(-4)}`;
  const playbookSearch = await searchPlaybooksBySemanticSimilarity(
    `${params.service} ${params.payloadSummary}`,
    2
  );
  const bestMatch = playbookSearch.matches[0];
  const trace: AmbientEventRecord['autonomousReadOnlyTrace'] = [];

  if (params.service === 'checkout-ledger-svc') {
    const t1 = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query:
          "SELECT deploy_id, service, git_sha, pr_number, canary_weight_pct, status FROM deployments WHERE service = 'checkout-ledger-svc'",
        row_limit: 5
      },
      callerRole: 'readonly_analyst'
    });
    trace.push({
      step: 1,
      serverId: 'sql-ops-mcp',
      toolName: 'sql_execute_readonly_query',
      args: t1.wireFrame.requestPayload,
      latencyMs: t1.wireFrame.latencyMs,
      findingSummary: 'Read-replica query returned active canary dep-9042 (git_sha=a8f31c9, PR #1842).'
    });

    const t2 = executeMCPToolCall({
      toolName: 'github_get_pr_diff',
      args: { pr_number: 1842 },
      callerRole: 'readonly_analyst'
    });
    trace.push({
      step: 2,
      serverId: 'github-mcp',
      toolName: 'github_get_pr_diff',
      args: { pr_number: 1842 },
      latencyMs: t2.wireFrame.latencyMs,
      findingSummary:
        'Diff inspection on PR #1842 detected unbounded SELECT ... FOR UPDATE lock in LedgerRepository.ts.'
    });
  } else {
    const t1 = executeMCPToolCall({
      toolName: 'github_blame_file_range',
      args: { file_path: 'src/http/WebhookClient.ts' },
      callerRole: 'readonly_analyst'
    });
    trace.push({
      step: 1,
      serverId: 'github-mcp',
      toolName: 'github_blame_file_range',
      args: { file_path: 'src/http/WebhookClient.ts' },
      latencyMs: t1.wireFrame.latencyMs,
      findingSummary: 'Git blame identified SHA c4190ab (PR #1835) modifying tlsHandshakeTimeoutMs to 400ms.'
    });
  }

  let rcaSynthesis =
    params.service === 'checkout-ledger-svc'
      ? 'Pre-computed RCA: Active canary dep-9042 (PR #1842, SHA a8f31c9) introduced an unbounded SELECT ... FOR UPDATE lock in LedgerRepository.ts, saturating PgBouncer (98%) and driving 5xx errors to 14.8%.'
      : `Pre-computed RCA: Commit c4190ab (PR #1835) lowered tlsHandshakeTimeoutMs to 400ms in WebhookClient.ts, causing cross-region TLS handshake timeouts on ${params.service}.`;

  const ai = getGenAI();
  if (ai) {
    try {
      const resp = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Synthesize a 2-sentence root-cause analysis for this ambient operations event. Event: ${params.payloadSummary} Service: ${params.service}`,
        config: { systemInstruction: playbookSearch.constructedSystemPrompt }
      });
      if (resp.text) rcaSynthesis = resp.text.trim();
    } catch {
      // Deterministic synthesis fallback
    }
  }

  const approvalToken = signApprovalToken({
    eventId,
    toolName: params.service === 'checkout-ledger-svc' ? 'infra_trigger_canary_rollback' : 'github_post_pr_review_comment',
    args: params.service === 'checkout-ledger-svc'
      ? { deploy_id: 'dep-9042', reason: `Ambient 1-Click Rollback for ${eventId}: PgBouncer lock contention in PR #1842` }
      : { pr_number: 1835, comment_body: `MonoPulse Ambient RCA (${eventId}): 400ms TLS timeout breaks cross-region EU handshakes.` }
  });
  const stagedMutations: StagedMutationAction[] =
    params.service === 'checkout-ledger-svc'
      ? [
          {
            id: `mut-${Date.now()}-1`,
            serverId: 'infra-mcp',
            toolName: 'infra_trigger_canary_rollback',
            description: 'Roll back canary deployment dep-9042 and restore 100% stable traffic',
            requiredRole: 'sre_admin',
            args: {
              deploy_id: 'dep-9042',
              reason: `Ambient 1-Click Rollback for ${eventId}: PgBouncer lock contention in PR #1842`
            },
            status: 'STAGED_FOR_1CLICK'
          },
          {
            id: `mut-${Date.now()}-2`,
            serverId: 'jira-mcp',
            toolName: 'jira_transition_ticket_status',
            description: 'Transition OPS-4821 status to Mitigated',
            requiredRole: 'support_tier2',
            args: { ticket_key: 'OPS-4821', new_status: 'Mitigated' },
            status: 'STAGED_FOR_1CLICK'
          },
          {
            id: `mut-${Date.now()}-3`,
            serverId: 'slack-mcp',
            toolName: 'slack_broadcast_resolution',
            description: 'Post verified mitigation summary to #inc-prod-alerts',
            requiredRole: 'support_tier2',
            args: {
              channel_name: '#inc-prod-alerts',
              resolution_message: `Executed 1-Click Rollback on dep-9042 (${eventId}).`
            },
            status: 'STAGED_FOR_1CLICK'
          }
        ]
      : [
          {
            id: `mut-${Date.now()}-1`,
            serverId: 'github-mcp',
            toolName: 'github_post_pr_review_comment',
            description: 'Post automated regression review comment on PR #1835',
            requiredRole: 'eng_lead',
            args: {
              pr_number: 1835,
              comment_body: `MonoPulse Ambient RCA (${eventId}): 400ms TLS timeout breaks cross-region EU handshakes.`
            },
            status: 'STAGED_FOR_1CLICK'
          }
        ];

  executeMCPToolCall({
    toolName: 'slack_post_approval_block',
    args: {
      thread_ts: params.service === 'checkout-ledger-svc' ? '1761406210.004200' : '1761405100.001900',
      event_id: eventId,
      summary_markdown: rcaSynthesis
    },
    callerRole: 'sre_admin'
  });

  const record: AmbientEventRecord = {
    eventId,
    source: params.source,
    channelOrTicket: params.channelOrTicket,
    service: params.service,
    incomingPayloadSummary: params.payloadSummary,
    receivedAt: new Date().toISOString(),
    precomputeLatencyMs: Math.max(420, Date.now() - start),
    perceivedUserWaitMs: 0,
    matchedPlaybook: bestMatch
      ? {
          id: bestMatch.playbook.id,
          title: bestMatch.playbook.title,
          cosineSimilarity: bestMatch.cosineSimilarity,
          stepReductionPct: bestMatch.playbook.stepReductionPct
        }
      : null,
    injectedSystemPrompt: playbookSearch.constructedSystemPrompt,
    autonomousReadOnlyTrace: trace,
    rootCauseSynthesis: rcaSynthesis,
    approvalToken,
    approvalState: 'STAGED_1CLICK_READY',
    stagedMutations
  };

  AMBIENT_EVENTS.unshift(record);
  REDIS_TIER1_STORE.unshift({
    key: `monopulse:approval_staging:${eventId}`,
    namespace: 'approval_staging',
    value: {
      event_id: eventId,
      approval_token: approvalToken,
      staged_mutations: stagedMutations.map((m) => m.toolName),
      playbook_used: record.matchedPlaybook?.id || 'NONE'
    },
    ttlSeconds: 1800,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString()
  });

  return record;
}

export function executeStagedApprovalBlock(params: {
  eventId: string;
  callerRole: RBACRole;
  editedMutations?: { id: string; args: Record<string, any> }[];
}): {
  success: boolean;
  event: AmbientEventRecord;
  results: { toolName: string; status: string; httpCode: number; detail: any }[];
} {
  const event = AMBIENT_EVENTS.find((e) => e.eventId === params.eventId);
  if (!event) {
    throw new Error(`Ambient event '${params.eventId}' not found.`);
  }

  let wasEdited = false;
  if (params.editedMutations && params.editedMutations.length > 0) {
    for (const edit of params.editedMutations) {
      const target = event.stagedMutations.find((m) => m.id === edit.id);
      if (target && edit.args) {
        target.args = edit.args;
        wasEdited = true;
      }
    }
  }

  const results: { toolName: string; status: string; httpCode: number; detail: any }[] = [];
  let allSucceeded = true;

  for (const mut of event.stagedMutations) {
    const mutToken = signApprovalToken({ eventId: event.eventId, toolName: mut.toolName, args: mut.args });
    const rpcRes = executeMCPToolCall({
      toolName: mut.toolName,
      args: mut.args,
      callerRole: params.callerRole,
      approvalToken: mutToken
    });

    if (rpcRes.status === 'SUCCESS') {
      mut.status = 'EXECUTED';
      mut.executionResult = rpcRes.result;
    } else {
      mut.status = 'FAILED';
      mut.executionResult = rpcRes.error;
      allSucceeded = false;
    }

    results.push({ toolName: mut.toolName, status: rpcRes.status, httpCode: rpcRes.httpCode, detail: rpcRes.result || rpcRes.error });
  }

  if (allSucceeded) {
    event.approvalState = wasEdited ? 'EDITED_AND_EXECUTED' : 'APPROVED_AND_EXECUTED';
    event.approvedByRole = params.callerRole;
    event.approvedAt = new Date().toISOString();
  }

  return { success: allSucceeded, event, results };
}
