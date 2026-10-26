export type RBACRole = 'sre_admin' | 'eng_lead' | 'support_tier2' | 'readonly_analyst';
export type ActiveModule =
  | 'incidents'
  | 'workspace'
  | 'integrations'
  | 'playbooks'
  | 'audit'
  | 'ambient'
  | 'mcp'
  | 'memory'
  | 'cli';

export function normalizeActiveModule(
  raw?: string | null
): 'incidents' | 'workspace' | 'integrations' | 'playbooks' | 'audit' {
  const clean = (raw || '').replace(/^#/, '').toLowerCase();
  if (clean === 'workspace') return 'workspace';
  if (clean === 'integrations' || clean === 'mcp') return 'integrations';
  if (clean === 'playbooks' || clean === 'memory') return 'playbooks';
  if (clean === 'audit' || clean === 'cli') return 'audit';
  return 'incidents';
}

export interface MCPServerMetadata {
  id: string;
  name: string;
  transport: string;
  version: string;
  domain: string;
  description: string;
  toolCount: number;
}

export interface MCPToolDefinition {
  name: string;
  serverId: string;
  description: string;
  isMutation: boolean;
  allowedRoles: RBACRole[];
  inputSchema: {
    type: 'object';
    properties: Record<
      string,
      { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }
    >;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface MCPWireFrame {
  frameId: string;
  timestamp: string;
  serverId: string;
  toolName: string;
  callerRole: RBACRole;
  isMutation: boolean;
  approvalTokenProvided: boolean;
  status: 'SUCCESS' | 'RBAC_DENIED' | 'SCHEMA_INVALID' | 'SQL_MUTATION_BLOCKED';
  latencyMs: number;
  requestPayload: Record<string, any>;
  responsePayload: Record<string, any>;
}

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

export interface PgVectorPlaybook {
  id: string;
  slug: string;
  title: string;
  triggerSignature: string;
  targetServices: string[];
  baselineStepsWithoutPlaybook: number;
  distilledStepsWithPlaybook: number;
  stepReductionPct: number;
  markdownSkill: string;
  embeddingModel: string;
  vectorDim: number;
  vectorPreview: number[];
  extractedFromTrajectoryId: string;
  createdAt: string;
  usageCount: number;
}

export interface RedisTier1Entry {
  key: string;
  namespace: string;
  value: Record<string, any>;
  ttlSeconds: number;
  createdAt: string;
  lastAccessedAt: string;
}

export interface KaggleDistillationJob {
  jobId: string;
  kernelSlug: string;
  accelerator: string;
  mode: string;
  sourceTrajectoryId: string;
  status: string;
  trajectoriesProcessed: number;
  rawStepCount: number;
  distilledStepCount: number;
  stepReductionPct: number;
  computeDurationMs: number;
  extractedPlaybookId: string;
  extractedMarkdown: string;
  timestamp: string;
}

export interface SystemState {
  engineVersion: string;
  architecturePosture: string;
  simulationMode?: boolean;
  metrics: {
    mcpServersCount: number;
    mcpToolsCount: number;
    avgStepReductionPct: number;
    legacyWeekOneAbandonmentPct: number;
    ambientWeeklyActiveRetentionPct: number;
    legacyAvgResponseSec: number;
    ambientPerceivedLatencySec: number;
  };
  mcpServers: MCPServerMetadata[];
  mcpTools: MCPToolDefinition[];
  wireLog: MCPWireFrame[];
  ambientEvents: AmbientEventRecord[];
  redisTier1: RedisTier1Entry[];
  pgvectorPlaybooks: PgVectorPlaybook[];
  kaggleGpuJobs: KaggleDistillationJob[];
  sandboxSnapshot: {
    sqlTables: string[];
    jiraTickets: any[];
    githubPrs: any[];
    slackThreads: any[];
    internalDocs: any[];
    podTelemetry: Record<string, any>;
  };
}

export const DEFAULT_TOOL_ARGS: Record<string, Record<string, any>> = {
  sql_execute_readonly_query: {
    query:
      "SELECT deploy_id, service, git_sha, pr_number, canary_weight_pct, status FROM deployments WHERE service = 'checkout-ledger-svc'",
    row_limit: 10
  },
  sql_inspect_table_schema: { table_name: 'deployments' },
  sql_explain_query_plan: {
    query:
      "SELECT id, amount_cents FROM ledger_entries WHERE org_id = 'org_acme_global' ORDER BY id DESC LIMIT 50"
  },
  sql_sample_recent_rows: { table_name: 'service_incidents', limit: 5 },
  sql_check_replication_lag: { cluster_name: 'ledger-prod-cluster' },
  github_get_pr_diff: { pr_number: 1842 },
  github_list_pr_checks: { pr_number: 1842 },
  github_blame_file_range: { file_path: 'src/repository/LedgerRepository.ts' },
  github_search_commits: { query: 'FOR UPDATE' },
  github_post_pr_review_comment: {
    pr_number: 1842,
    comment_body:
      'Automated RCA: Unbounded SELECT ... FOR UPDATE without SKIP LOCKED saturated PgBouncer pool.'
  },
  slack_fetch_thread_messages: { thread_ts: '1761406210.004200' },
  slack_summarize_incident_thread: { thread_ts: '1761406210.004200' },
  slack_search_channel_history: { keyword: 'PgBouncer' },
  slack_post_approval_block: {
    thread_ts: '1761406210.004200',
    event_id: 'evt-ambient-901',
    summary_markdown: 'Pre-computed 1-Click Rollback staged for canary dep-9042.'
  },
  slack_broadcast_resolution: {
    channel_name: '#inc-prod-alerts',
    resolution_message: 'Canary dep-9042 rolled back; HTTP 5xx rate restored to 0.18%.'
  },
  jira_get_ticket_context: { ticket_key: 'OPS-4821' },
  jira_search_similar_issues: { service: 'checkout-ledger-svc' },
  jira_transition_ticket_status: { ticket_key: 'OPS-4821', new_status: 'Mitigated' },
  jira_assign_oncall_owner: { ticket_key: 'OPS-4821', assignee: 'mchen' },
  jira_append_root_cause_field: {
    ticket_key: 'OPS-4821',
    root_cause_notes: 'PR #1842 (commit a8f31c9) held unbounded row locks in LedgerRepository.ts.'
  },
  docs_semantic_search: { query: 'PgBouncer connection pool exhaustion' },
  docs_get_runbook_by_service: { service: 'checkout-ledger-svc' },
  docs_list_postmortems: { service: 'checkout-ledger-svc' },
  docs_propose_runbook_patch: {
    doc_id: 'RUNBOOK-LEDGER-01',
    patch_markdown:
      'Always verify `SKIP LOCKED` and `LIMIT <= 250` on batch reconciliation queries before promoting canary.'
  },
  infra_get_service_error_rate: { service: 'checkout-ledger-svc' },
  infra_fetch_pod_logs: { service: 'checkout-ledger-svc' },
  infra_check_feature_flags: { service: 'checkout-ledger-svc' },
  infra_trigger_canary_rollback: {
    deploy_id: 'dep-9042',
    reason: 'Emergency rollback due to PgBouncer connection pool exhaustion (98%)'
  }
};
