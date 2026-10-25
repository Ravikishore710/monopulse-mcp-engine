import React, { useEffect, useState } from 'react';
import {
  Terminal,
  ShieldAlert,
  Database,
  Cpu,
  Check,
  Edit3,
  Play,
  Search,
  RefreshCw,
  AlertTriangle,
  Sliders,
  Code2,
  ArrowRight,
  Layers
} from 'lucide-react';

type RBACRole = 'sre_admin' | 'eng_lead' | 'support_tier2' | 'readonly_analyst';
type ActiveModule = 'ambient' | 'mcp' | 'memory' | 'cli';

interface MCPServerMetadata {
  id: string;
  name: string;
  transport: string;
  version: string;
  domain: string;
  description: string;
  toolCount: number;
}

interface MCPToolDefinition {
  name: string;
  serverId: string;
  description: string;
  isMutation: boolean;
  allowedRoles: RBACRole[];
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }>;
    required: string[];
    additionalProperties: boolean;
  };
}

interface MCPWireFrame {
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

interface StagedMutationAction {
  id: string;
  serverId: string;
  toolName: string;
  description: string;
  requiredRole: RBACRole;
  args: Record<string, any>;
  status: 'STAGED_FOR_1CLICK' | 'EXECUTED' | 'FAILED';
  executionResult?: any;
}

interface AmbientEventRecord {
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

interface PgVectorPlaybook {
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

interface RedisTier1Entry {
  key: string;
  namespace: string;
  value: Record<string, any>;
  ttlSeconds: number;
  createdAt: string;
  lastAccessedAt: string;
}

interface KaggleDistillationJob {
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

interface SystemState {
  engineVersion: string;
  architecturePosture: string;
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

const DEFAULT_TOOL_ARGS: Record<string, Record<string, any>> = {
  sql_execute_readonly_query: {
    query: "SELECT deploy_id, service, git_sha, pr_number, canary_weight_pct, status FROM deployments WHERE service = 'checkout-ledger-svc'",
    row_limit: 10
  },
  sql_inspect_table_schema: { table_name: 'deployments' },
  sql_explain_query_plan: {
    query: "SELECT id, amount_cents FROM ledger_entries WHERE org_id = 'org_acme_global' FOR UPDATE"
  },
  sql_sample_recent_rows: { table_name: 'service_incidents', limit: 5 },
  sql_check_replication_lag: { cluster_name: 'ledger-prod-cluster' },
  github_get_pr_diff: { pr_number: 1842 },
  github_list_pr_checks: { pr_number: 1842 },
  github_blame_file_range: { file_path: 'src/repository/LedgerRepository.ts' },
  github_search_commits: { query: 'FOR UPDATE' },
  github_post_pr_review_comment: {
    pr_number: 1842,
    comment_body: 'Automated RCA: Unbounded SELECT ... FOR UPDATE without SKIP LOCKED saturated PgBouncer pool.'
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
    patch_markdown: 'Always verify `SKIP LOCKED` and `LIMIT <= 250` on batch reconciliation queries before promoting canary.'
  },
  infra_get_service_error_rate: { service: 'checkout-ledger-svc' },
  infra_fetch_pod_logs: { service: 'checkout-ledger-svc' },
  infra_check_feature_flags: { service: 'checkout-ledger-svc' },
  infra_trigger_canary_rollback: {
    deploy_id: 'dep-9042',
    reason: 'Emergency rollback due to PgBouncer connection pool exhaustion (98%)'
  }
};

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState<ActiveModule>('ambient');
  const [callerRole, setCallerRole] = useState<RBACRole>('sre_admin');

  // Module 1: Ambient Event Bus & War Story state
  const [selectedEventId, setSelectedEventId] = useState<string>('evt-ambient-901');
  const [webhookService, setWebhookService] = useState<'checkout-ledger-svc' | 'webhook-dispatcher-v2'>('checkout-ledger-svc');
  const [webhookSource, setWebhookSource] = useState<'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert'>('slack.incident.webhook');
  const [webhookSummary, setWebhookSummary] = useState<string>(
    '[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'
  );
  const [ingestingWebhook, setIngestingWebhook] = useState(false);
  const [editingMutations, setEditingMutations] = useState<Record<string, string>>({});
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [approvalFeedback, setApprovalFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [showLegacyComparison, setShowLegacyComparison] = useState(false);

  // Module 2: MCP Surface & RBAC Boundary state
  const [selectedServerFilter, setSelectedServerFilter] = useState<string>('all');
  const [toolSearchQuery, setToolSearchQuery] = useState<string>('');
  const [selectedToolName, setSelectedToolName] = useState<string>('sql_execute_readonly_query');
  const [rpcArgsText, setRpcArgsText] = useState<string>(
    JSON.stringify(DEFAULT_TOOL_ARGS['sql_execute_readonly_query'], null, 2)
  );
  const [rpcResponse, setRpcResponse] = useState<any>(null);
  const [executingRpc, setExecutingRpc] = useState(false);

  // Module 3: Memory & Kaggle GPU state
  const [semanticQuery, setSemanticQuery] = useState<string>(
    'PgBouncer connection pool exhaustion and HTTP 5xx spike on checkout-ledger-svc canary'
  );
  const [semanticSearchRes, setSemanticSearchRes] = useState<any>(null);
  const [searchingMemory, setSearchingMemory] = useState(false);
  const [runningKaggleJob, setRunningKaggleJob] = useState(false);
  const [distillService, setDistillService] = useState<string>('checkout-ledger-svc');
  const [distillSummary, setDistillSummary] = useState<string>(
    'Distill multi-step PgBouncer lock contention trajectory into a zero-question ambient playbook skill.'
  );

  // Module 4: CLI & Wire RPC state
  const [cliInput, setCliInput] = useState<string>('monopulse mcp list');
  const [cliHistory, setCliHistory] = useState<{ command: string; exitCode: number; output: string; timestamp: string }[]>([
    {
      command: 'monopulse help',
      exitCode: 0,
      timestamp: '15:22:00 UTC',
      output: `MonoPulse Operations Engine CLI (v3.4.0-MCP)
Type or click a preset command below to execute directly against the backend JSON-RPC & webhook bus:
  monopulse mcp list                           List all 6 custom MCP servers and 28 deterministic tools
  monopulse rbac test-unauthorized             Verify protocol-level RBAC & SQL DML rejection
  monopulse webhook emit ledger                Trigger background pre-computation & stage 1-Click Approval
  monopulse memory search "PgBouncer lock"     Run pgvector cosine similarity & prompt injection preview
  monopulse kaggle distill evt-ambient-901     Offload trajectory distillation to Kaggle GPU bridge`
    }
  ]);
  const [runningCli, setRunningCli] = useState(false);

  const fetchSystemState = async () => {
    try {
      const res = await fetch('/api/system/state');
      const data: SystemState = await res.json();
      setState(data);
      if (data.ambientEvents.length > 0 && !data.ambientEvents.some((e) => e.eventId === selectedEventId)) {
        setSelectedEventId(data.ambientEvents[0].eventId);
      }
    } catch (err) {
      console.error('Failed to fetch system state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemState();
  }, []);

  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    const defaultArgs = DEFAULT_TOOL_ARGS[toolName] || {};
    setRpcArgsText(JSON.stringify(defaultArgs, null, 2));
    setRpcResponse(null);
  };

  const handleEmitWebhook = async (overrideService?: 'checkout-ledger-svc' | 'webhook-dispatcher-v2') => {
    setIngestingWebhook(true);
    setApprovalFeedback(null);
    const targetSvc = overrideService || webhookService;
    const summaryText =
      overrideService === 'webhook-dispatcher-v2'
        ? 'Jira OPS-4819: Cross-region webhook TLS handshake ETIMEDOUT on eu-central-1 tenants after commit c4190ab.'
        : webhookSummary;
    try {
      const res = await fetch('/api/webhooks/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: webhookSource,
          service: targetSvc,
          channelOrTicket:
            targetSvc === 'checkout-ledger-svc'
              ? '#inc-prod-alerts · OPS-4821'
              : 'OPS-4819 · #tier2-customer-escalations',
          payloadSummary: summaryText
        })
      });
      const data = await res.json();
      await fetchSystemState();
      if (data.event?.eventId) {
        setSelectedEventId(data.event.eventId);
        setActiveModule('ambient');
      }
    } finally {
      setIngestingWebhook(false);
    }
  };

  const handleApproveEvent = async (event: AmbientEventRecord) => {
    setApprovalFeedback(null);
    const editedList: { id: string; args: Record<string, any> }[] = [];

    if (isEditingBlock) {
      for (const mut of event.stagedMutations) {
        const raw = editingMutations[mut.id];
        if (raw) {
          try {
            editedList.push({ id: mut.id, args: JSON.parse(raw) });
          } catch (e: any) {
            setApprovalFeedback({
              type: 'error',
              message: `Invalid JSON in edited parameters for ${mut.toolName}: ${e?.message}`
            });
            return;
          }
        }
      }
    }

    const res = await fetch(`/api/events/${event.eventId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerRole,
        editedMutations: editedList.length > 0 ? editedList : undefined
      })
    });
    const data = await res.json();
    await fetchSystemState();

    if (data.success) {
      setIsEditingBlock(false);
      setApprovalFeedback({
        type: 'success',
        message: `1-Click Approval executed (${data.results.length} mutations verified under role '${callerRole}').`
      });
    } else {
      const failed = data.results?.find((r: any) => r.status !== 'SUCCESS');
      setApprovalFeedback({
        type: 'error',
        message: `MCP Boundary blocked mutation '${failed?.toolName}': ${failed?.detail?.message || 'RBAC policy denied for current role.'}`
      });
    }
  };

  const handleDispatchMCPTool = async (customTool?: string, customArgs?: any, customRole?: RBACRole) => {
    setExecutingRpc(true);
    const toolToCall = customTool || selectedToolName;
    const roleToUse = customRole || callerRole;
    let parsedArgs: any = customArgs;

    if (!parsedArgs) {
      try {
        parsedArgs = JSON.parse(rpcArgsText);
      } catch (e: any) {
        setRpcResponse({
          status: 'JSON_PARSE_ERROR',
          httpCode: 400,
          error: { message: `Client JSON Syntax Error: ${e?.message}` }
        });
        setExecutingRpc(false);
        return;
      }
    } else {
      setSelectedToolName(toolToCall);
      setRpcArgsText(JSON.stringify(parsedArgs, null, 2));
      if (customRole) setCallerRole(customRole);
    }

    try {
      const res = await fetch('/api/mcp/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolToCall,
            arguments: parsedArgs,
            callerRole: roleToUse
          }
        })
      });
      const data = await res.json();
      setRpcResponse(data);
      await fetchSystemState();
    } finally {
      setExecutingRpc(false);
    }
  };

  const handleRunSemanticSearch = async (overrideQuery?: string) => {
    setSearchingMemory(true);
    const q = overrideQuery ?? semanticQuery;
    if (overrideQuery) setSemanticQuery(overrideQuery);
    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, topK: 3 })
      });
      const data = await res.json();
      setSemanticSearchRes(data);
    } finally {
      setSearchingMemory(false);
    }
  };

  const handleDistillViaKaggle = async (sourceEventId?: string) => {
    setRunningKaggleJob(true);
    try {
      const res = await fetch('/api/kaggle/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: sourceEventId || selectedEventId,
          customService: distillService,
          customIncidentSummary: distillSummary
        })
      });
      await res.json();
      await fetchSystemState();
      if (sourceEventId) {
        setActiveModule('memory');
      }
    } finally {
      setRunningKaggleJob(false);
    }
  };

  const handleRunCliCommand = async (cmdOverride?: string) => {
    const cmd = (cmdOverride ?? cliInput).trim();
    if (!cmd) return;
    setRunningCli(true);
    if (cmdOverride) setCliInput(cmdOverride);
    try {
      const res = await fetch('/api/cli/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, callerRole })
      });
      const data = await res.json();
      setCliHistory((prev) => [
        {
          command: cmd,
          exitCode: data.exitCode ?? 0,
          output: data.output || '',
          timestamp: new Date().toISOString().slice(11, 19) + ' UTC'
        },
        ...prev
      ]);
      await fetchSystemState();
    } finally {
      setRunningCli(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex items-center justify-center p-8">
        <div className="max-w-md w-full border border-[#1F2937] bg-[#111827] p-6 rounded-lg space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]">
            <span>MONOPULSE CORE ENGINE</span>
            <span>INITIALIZING MCP BUS</span>
          </div>
          <div className="h-2 bg-[#1F2937] rounded overflow-hidden">
            <div className="h-full w-2/3 bg-[#2563EB]" />
          </div>
          <p className="text-xs text-[#9CA3AF]">
            Mounting 6 MCP servers (28 deterministic tools), Tier-1 Redis state store, Tier-2 pgvector index, and Kaggle GPU distillation bridge...
          </p>
        </div>
      </div>
    );
  }

  const selectedEvent =
    state.ambientEvents.find((e) => e.eventId === selectedEventId) || state.ambientEvents[0];
  const selectedTool =
    state.mcpTools.find((t) => t.name === selectedToolName) || state.mcpTools[0];
  const filteredTools = state.mcpTools.filter((t) => {
    const matchesServer = selectedServerFilter === 'all' || t.serverId === selectedServerFilter;
    const matchesSearch =
      !toolSearchQuery ||
      t.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(toolSearchQuery.toLowerCase());
    return matchesServer && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-[#1F2937] bg-[#0B0F17] sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('ambient');
          }}
          className="text-lg font-bold tracking-tight text-[#F9FAFB] font-display whitespace-nowrap shrink-0"
        >
          MonoPulse
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#9CA3AF]">
          <button
            onClick={() => setActiveModule('ambient')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'ambient' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            Ambient Event Bus
          </button>
          <button
            onClick={() => setActiveModule('mcp')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'mcp' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            MCP Surface &amp; RBAC
          </button>
          <button
            onClick={() => setActiveModule('memory')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'memory' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            Memory &amp; Kaggle GPU
          </button>
          <button
            onClick={() => setActiveModule('cli')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'cli' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            CLI &amp; Wire Protocol
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => handleEmitWebhook('checkout-ledger-svc')}
            disabled={ingestingWebhook}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-md hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {ingestingWebhook ? 'Pre-Computing Event...' : 'Emit Incident Webhook'}
          </button>
        </div>
      </header>

      {/* Workspace Canvas: Sidebar (260px) + Main Viewport */}
      <div className="flex-1 flex min-h-0">
        {/* Left System Navigation & Caller Identity Rail */}
        <aside className="w-[268px] shrink-0 border-r border-[#1F2937] bg-[#0E131F] p-5 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-6">
            <div>
              <div className="text-xs font-medium text-[#9CA3AF] mb-2">System Modules</div>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveModule('ambient')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'ambient'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Layers className="w-4 h-4 shrink-0" />
                    <span>01. Ambient Event Bus</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.ambientEvents.length}</span>
                </button>

                <button
                  onClick={() => setActiveModule('mcp')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'mcp'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>02. MCP Tool Boundary</span>
                  </span>
                  <span className="font-mono tabular-nums">6 / 28</span>
                </button>

                <button
                  onClick={() => setActiveModule('memory')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'memory'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Database className="w-4 h-4 shrink-0" />
                    <span>03. Memory &amp; Playbooks</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.pgvectorPlaybooks.length}</span>
                </button>

                <button
                  onClick={() => setActiveModule('cli')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'cli'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span>04. Live CLI &amp; Wire Log</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.wireLog.length}</span>
                </button>
              </div>
            </div>

            {/* Active Caller RBAC Identity Selector */}
            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-xs font-medium text-[#9CA3AF] mb-1.5">
                Active Caller RBAC Token
              </div>
              <p className="text-xs text-[#9CA3AF]/80 mb-3 leading-relaxed">
                Enforced at the MCP JSON-RPC boundary before any tool handler executes.
              </p>
              <div className="space-y-1.5">
                {(
                  [
                    { role: 'sre_admin', desc: 'Full Read + Canary Rollback + Mutations' },
                    { role: 'eng_lead', desc: 'Read + PR Review & Jira RCA Writes' },
                    { role: 'support_tier2', desc: 'Read + Jira Status & Slack Broadcast' },
                    { role: 'readonly_analyst', desc: 'Strictly Read-Only Tools (0 Mutations)' }
                  ] as { role: RBACRole; desc: string }[]
                ).map((item) => (
                  <button
                    key={item.role}
                    onClick={() => setCallerRole(item.role)}
                    className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                      callerRole === item.role
                        ? 'bg-[#111827] border-[#2563EB] text-[#F9FAFB]'
                        : 'bg-[#0B0F17] border-[#1F2937] text-[#9CA3AF] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono font-semibold">
                      <span>{item.role}</span>
                      {callerRole === item.role && <span className="text-[#2563EB]">ACTIVE</span>}
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Registered 6 MCP Servers Quick Index */}
            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-xs font-medium text-[#9CA3AF] mb-2.5">
                Mounted MCP Servers (JSON-RPC 2.0)
              </div>
              <div className="space-y-2 text-xs">
                {state.mcpServers.map((srv) => (
                  <div
                    key={srv.id}
                    onClick={() => {
                      setSelectedServerFilter(srv.id);
                      setActiveModule('mcp');
                    }}
                    className="flex items-center justify-between text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer py-0.5"
                  >
                    <span className="font-mono truncate">{srv.id}</span>
                    <span className="font-mono tabular-nums text-[#9CA3AF]">
                      {srv.toolCount} tools
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#1F2937] text-[11px] text-[#9CA3AF] space-y-1 font-mono">
            <div>Runtime · Node.js + Express MCP</div>
            <div>Memory · pgvector + Redis TTL</div>
            <div>GPU Bridge · Kaggle NVIDIA T4x2</div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main id="top" className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 overflow-y-auto">
          {/* Quantitative Architecture Telemetry Strip */}
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">MCP Tool Surface &amp; Boundary</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#F9FAFB]">
                  6 Servers · 28 Tools
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Draft-07 JSON Schema · Granular RBAC Gate
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Playbook Extractor Efficiency</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#16A34A]">
                  -{state.metrics.avgStepReductionPct}% Steps
                </span>
                <span className="text-xs font-mono tabular-nums text-[#9CA3AF]">
                  8.0 → 5.0 avg
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                pgvector cosine injection + Kaggle GPU distillation
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Perceived Incident Triage Latency</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#F9FAFB]">
                  0.4s Ambient
                </span>
                <span className="text-xs font-mono tabular-nums text-[#D97706]">
                  vs 46.4s Sync Chat
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Pre-computed on webhook arrival · 0 clarifying questions
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Weekly Active Operator Retention</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#16A34A]">
                  84.0% Retained
                </span>
                <span className="text-xs font-mono tabular-nums text-[#DC2626]">
                  Up from 28.0%
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Eliminated 72% week-one chat abandonment drop-off
              </div>
            </div>
          </section>

          {/* =====================================================================
              MODULE 1: AMBIENT EVENT BUS & 1-CLICK APPROVAL WORKBENCH
             ===================================================================== */}
          {activeModule === 'ambient' && (
            <div className="space-y-6">
              {/* Top Section Header & Legacy vs Ambient Benchmark Toggle */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
                <div>
                  <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
                    01. Ambient Event-Driven Pre-Computation &amp; 1-Click Approval Bus
                  </h1>
                  <p className="text-xs text-[#9CA3AF] mt-1">
                    Re-architected from a 45-second synchronous chatbot into a silent webhook pre-computation pipeline that posts a single 1-Click Approve/Edit block.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowLegacyComparison(!showLegacyComparison)}
                    className="px-3.5 py-2 text-xs font-medium border border-[#1F2937] bg-[#111827] text-[#F9FAFB] rounded-md hover:border-slate-600 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {showLegacyComparison
                      ? 'Hide Legacy Sync Chat War Story'
                      : 'Compare Legacy Sync Chat (72% Drop-off) vs Ambient'}
                  </button>
                </div>
              </div>

              {/* Optional Side-by-Side War Story Architecture Benchmark */}
              {showLegacyComparison && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 border border-[#1F2937] bg-[#111827] p-5 rounded-lg">
                  <div className="border border-[#1F2937] bg-[#0B0F17] p-4 rounded-md space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#DC2626] font-semibold">
                        LEGACY V1: SYNCHRONOUS CHATBOT LOOP (ABANDONED)
                      </span>
                      <span className="tabular-nums text-[#9CA3AF]">
                        46.4s Wait · 72% Abandonment
                      </span>
                    </div>
                    <div className="space-y-2 text-xs font-mono text-[#9CA3AF]">
                      <div className="p-2 bg-[#111827] rounded">
                        [00.0s] On-Call Engineer: &quot;checkout-ledger-svc is throwing 503s, what happened?&quot;
                      </div>
                      <div className="p-2 bg-[#111827] rounded text-[#D97706]">
                        [14.2s] Legacy Bot: &quot;Which cloud region and environment (staging or prod) should I check? Also please provide the Jira key.&quot;
                      </div>
                      <div className="p-2 bg-[#111827] rounded">
                        [24.0s] On-Call Engineer: &quot;us-east-1 prod, OPS-4821. Just check the latest deploy!&quot;
                      </div>
                      <div className="p-2 bg-[#111827] rounded text-[#D97706]">
                        [46.4s] Legacy Bot: &quot;Ran 8 unguided schema &amp; log queries. Would you like me to check GitHub PR #1842 next?&quot;
                      </div>
                    </div>
                    <p className="text-xs text-[#9CA3AF]">
                      Outcome: Responder switches to manual terminal debugging before the chatbot finishes asking clarifying questions.
                    </p>
                  </div>

                  <div className="border border-[#1F2937] bg-[#0B0F17] p-4 rounded-md space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#16A34A] font-semibold">
                        MONOPULSE V2: AMBIENT EVENT PRE-COMPUTATION
                      </span>
                      <span className="tabular-nums text-[#9CA3AF]">
                        0.4s Perceived · 84% Retention
                      </span>
                    </div>
                    <div className="space-y-2 text-xs font-mono text-[#9CA3AF]">
                      <div className="p-2 bg-[#111827] rounded">
                        [T+0.0s] PagerDuty / Slack Webhook fires on #inc-prod-alerts (OPS-4821).
                      </div>
                      <div className="p-2 bg-[#111827] rounded text-[#F9FAFB]">
                        [T+0.1s] Tier-2 pgvector matches Playbook PB-LEDGER-CANARY-01 (cosine sim: 0.9684, -37.5% steps).
                      </div>
                      <div className="p-2 bg-[#111827] rounded text-[#F9FAFB]">
                        [T+1.4s] Background worker runs 3 deterministic read-only MCP tools (SQL + GitHub Diff + Pod Logs).
                      </div>
                      <div className="p-2 bg-[#111827] rounded text-[#16A34A]">
                        [T+1.6s] Posts 1-Click Approve/Edit Summary Block in Slack before engineer even opens thread.
                      </div>
                    </div>
                    <p className="text-xs text-[#9CA3AF]">
                      Outcome: Zero chat interrogation. Engineer reviews pre-computed RCA and clicks Approve in 1 click.
                    </p>
                  </div>
                </div>
              )}

              {/* Webhook Simulator Bar */}
              <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#F9FAFB]">
                    Simulate Incoming Organizational Event Webhook
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
                    <span>Preset Triggers:</span>
                    <button
                      onClick={() => {
                        setWebhookService('checkout-ledger-svc');
                        setWebhookSource('slack.incident.webhook');
                        setWebhookSummary(
                          '[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'
                        );
                      }}
                      className="underline hover:text-[#F9FAFB] cursor-pointer"
                    >
                      P0 Ledger Canary Lock
                    </button>
                    <span>·</span>
                    <button
                      onClick={() => {
                        setWebhookService('webhook-dispatcher-v2');
                        setWebhookSource('jira.issue.created');
                        setWebhookSummary(
                          'Jira OPS-4819 created: Cross-region EU webhook TLS handshake ETIMEDOUT after PR #1835 reduced timeout to 400ms.'
                        );
                      }}
                      className="underline hover:text-[#F9FAFB] cursor-pointer"
                    >
                      P1 EU Webhook TLS Timeout
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-3">
                    <label className="block text-xs text-[#9CA3AF] mb-1">Event Source</label>
                    <select
                      value={webhookSource}
                      onChange={(e) => setWebhookSource(e.target.value as any)}
                      className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs font-mono text-[#F9FAFB]"
                    >
                      <option value="slack.incident.webhook">slack.incident.webhook</option>
                      <option value="jira.issue.created">jira.issue.created</option>
                      <option value="github.canary.alert">github.canary.alert</option>
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs text-[#9CA3AF] mb-1">Target Microservice</label>
                    <select
                      value={webhookService}
                      onChange={(e) => setWebhookService(e.target.value as any)}
                      className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs font-mono text-[#F9FAFB]"
                    >
                      <option value="checkout-ledger-svc">checkout-ledger-svc</option>
                      <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
                    </select>
                  </div>

                  <div className="md:col-span-4">
                    <label className="block text-xs text-[#9CA3AF] mb-1">Webhook Event Payload</label>
                    <input
                      type="text"
                      value={webhookSummary}
                      onChange={(e) => setWebhookSummary(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
                    />
                  </div>

                  <div className="md:col-span-2 flex items-end">
                    <button
                      onClick={() => handleEmitWebhook()}
                      disabled={ingestingWebhook}
                      className="w-full px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      {ingestingWebhook ? 'Running...' : 'Ingest & Pre-Compute'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Split View: Event Queue (Left 4 cols) + Ambient Pre-Computation & 1-Click Block Inspector (Right 8 cols) */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left Column: Event Queue */}
                <div className="xl:col-span-4 space-y-3">
                  <div className="text-xs font-semibold text-[#9CA3AF]">
                    Ambient Pre-Computed Event Queue ({state.ambientEvents.length})
                  </div>
                  {state.ambientEvents.map((evt) => {
                    const isSelected = evt.eventId === selectedEvent?.eventId;
                    return (
                      <div
                        key={evt.eventId}
                        onClick={() => {
                          setSelectedEventId(evt.eventId);
                          setIsEditingBlock(false);
                          setApprovalFeedback(null);
                        }}
                        className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#111827] border-[#2563EB]'
                            : 'bg-[#0E131F] border-[#1F2937] hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]">
                          <span className="text-[#F9FAFB] font-semibold">{evt.eventId}</span>
                          <span>
                            {evt.approvalState === 'STAGED_1CLICK_READY' ? (
                              <span className="text-[#D97706]">1-CLICK READY</span>
                            ) : (
                              <span className="text-[#16A34A]">{evt.approvalState}</span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs font-medium text-[#F9FAFB]">
                          {evt.service} · {evt.channelOrTicket}
                        </div>
                        <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-2">
                          {evt.incomingPayloadSummary}
                        </p>
                        <div className="mt-2.5 pt-2 border-t border-[#1F2937] flex items-center justify-between text-[11px] font-mono text-[#9CA3AF] tabular-nums">
                          <span>Playbook: {evt.matchedPlaybook?.id || 'NONE'}</span>
                          <span>Precompute: {evt.precomputeLatencyMs}ms</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Column: Detailed Ambient Pre-Computation & 1-Click Approval Block */}
                {selectedEvent && (
                  <div className="xl:col-span-8 border border-[#1F2937] bg-[#111827] rounded-lg p-6 space-y-6">
                    {/* Event Header Metadata (Unboxed with typographic separators) */}
                    <div className="border-b border-[#1F2937] pb-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#9CA3AF]">
                        <div>
                          <span className="text-[#F9FAFB] font-semibold">{selectedEvent.eventId}</span>
                          <span className="mx-2">·</span>
                          <span>{selectedEvent.source}</span>
                          <span className="mx-2">·</span>
                          <span>{selectedEvent.channelOrTicket}</span>
                        </div>
                        <div className="tabular-nums">
                          Background Precompute: {selectedEvent.precomputeLatencyMs}ms · Perceived User Wait: 0ms
                        </div>
                      </div>
                      <h3 className="text-base font-bold text-[#F9FAFB]">
                        {selectedEvent.incomingPayloadSummary}
                      </h3>
                    </div>

                    {/* Step 1: Matched Tier-2 pgvector Playbook & Dynamic Prompt Injection */}
                    {selectedEvent.matchedPlaybook && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#F9FAFB]">
                            Step 1 · Tier-2 pgvector Playbook Match &amp; System Prompt Injection
                          </span>
                          <span className="font-mono tabular-nums text-[#16A34A]">
                            Cosine Similarity: {selectedEvent.matchedPlaybook.cosineSimilarity} · Step Reduction: -{selectedEvent.matchedPlaybook.stepReductionPct}%
                          </span>
                        </div>
                        <pre className="p-3.5 rounded-md bg-[#0B0F17] border border-[#1F2937] text-xs font-mono text-[#9CA3AF] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {selectedEvent.injectedSystemPrompt}
                        </pre>
                      </div>
                    )}

                    {/* Step 2: Autonomous Read-Only MCP Diagnostic Trace */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#F9FAFB]">
                          Step 2 · Autonomous Background Read-Only MCP Tool Trace ({selectedEvent.autonomousReadOnlyTrace.length} calls)
                        </span>
                        <span className="font-mono text-[#9CA3AF]">
                          Zero mutations permitted during pre-computation
                        </span>
                      </div>
                      <div className="border border-[#1F2937] rounded-md divide-y divide-[#1F2937] bg-[#0B0F17]">
                        {selectedEvent.autonomousReadOnlyTrace.map((t) => (
                          <div key={t.step} className="p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between font-mono">
                              <div>
                                <span className="text-[#9CA3AF]">#{t.step}</span>
                                <span className="mx-2 text-[#2563EB] font-semibold">{t.toolName}</span>
                                <span className="text-[#9CA3AF]">({t.serverId})</span>
                              </div>
                              <span className="tabular-nums text-[#9CA3AF]">{t.latencyMs}ms</span>
                            </div>
                            <div className="font-mono text-[11px] text-[#9CA3AF] truncate">
                              args: {JSON.stringify(t.args)}
                            </div>
                            <div className="text-[#F9FAFB] pt-0.5">{t.findingSummary}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Step 3: Ambient 1-Click Approve / Edit Summary Block */}
                    <div className="border border-[#2563EB]/60 bg-[#0B0F17] rounded-lg p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
                        <div>
                          <div className="text-xs font-mono text-[#2563EB] font-semibold">
                            SLACK / JIRA AMBIENT BLOCK · 1-CLICK APPROVE / EDIT
                          </div>
                          <div className="text-xs text-[#9CA3AF] mt-0.5">
                            Signed Approval Token: <code className="font-mono text-[#F9FAFB]">{selectedEvent.approvalToken}</code> · Active Caller Role: <code className="font-mono text-[#F9FAFB]">{callerRole}</code>
                          </div>
                        </div>
                        <div className="text-xs font-mono">
                          {selectedEvent.approvalState === 'STAGED_1CLICK_READY' ? (
                            <span className="text-[#D97706]">AWAITING 1-CLICK SIGN-OFF</span>
                          ) : (
                            <span className="text-[#16A34A]">
                              {selectedEvent.approvalState} BY {selectedEvent.approvedByRole?.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-[#F9FAFB] leading-relaxed bg-[#111827] p-3.5 rounded border border-[#1F2937]">
                        <span className="font-semibold text-[#9CA3AF] block mb-1">
                          Pre-Computed Root Cause Synthesis:
                        </span>
                        {selectedEvent.rootCauseSynthesis}
                      </div>

                      {/* Staged Mutation Tool Calls */}
                      <div className="space-y-2.5">
                        <div className="text-xs font-semibold text-[#9CA3AF]">
                          Staged MCP Write Mutations ({selectedEvent.stagedMutations.length})
                        </div>
                        {selectedEvent.stagedMutations.map((mut) => (
                          <div
                            key={mut.id}
                            className="p-3 rounded border border-[#1F2937] bg-[#111827] space-y-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                              <div>
                                <span className="text-[#F9FAFB] font-semibold">{mut.toolName}</span>
                                <span className="mx-1.5 text-[#9CA3AF]">·</span>
                                <span className="text-[#9CA3AF]">{mut.serverId}</span>
                                <span className="mx-1.5 text-[#9CA3AF]">·</span>
                                <span className="text-[#D97706]">Requires: {mut.requiredRole}+</span>
                              </div>
                              <span
                                className={
                                  mut.status === 'EXECUTED'
                                    ? 'text-[#16A34A]'
                                    : mut.status === 'FAILED'
                                    ? 'text-[#DC2626]'
                                    : 'text-[#9CA3AF]'
                                }
                              >
                                {mut.status}
                              </span>
                            </div>
                            <div className="text-[#9CA3AF]">{mut.description}</div>

                            {isEditingBlock ? (
                              <div>
                                <label className="block text-[11px] font-mono text-[#9CA3AF] mb-1">
                                  Edit JSON Arguments for {mut.toolName}:
                                </label>
                                <textarea
                                  rows={3}
                                  value={
                                    editingMutations[mut.id] ?? JSON.stringify(mut.args, null, 2)
                                  }
                                  onChange={(e) =>
                                    setEditingMutations((prev) => ({
                                      ...prev,
                                      [mut.id]: e.target.value
                                    }))
                                  }
                                  className="w-full bg-[#0B0F17] border border-[#2563EB] rounded p-2 font-mono text-xs text-[#F9FAFB]"
                                />
                              </div>
                            ) : (
                              <pre className="p-2 bg-[#0B0F17] rounded text-[11px] font-mono text-[#9CA3AF] overflow-x-auto">
                                {JSON.stringify(mut.args, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>

                      {approvalFeedback && (
                        <div
                          className={`p-3 rounded border text-xs font-mono ${
                            approvalFeedback.type === 'success'
                              ? 'border-[#16A34A] bg-[#16A34A]/10 text-[#F9FAFB]'
                              : 'border-[#DC2626] bg-[#DC2626]/10 text-[#F9FAFB]'
                          }`}
                        >
                          {approvalFeedback.message}
                        </div>
                      )}

                      {/* 1-Click Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            onClick={() => handleApproveEvent(selectedEvent)}
                            className="px-4 py-2 bg-[#16A34A] hover:bg-green-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                          >
                            <Check className="w-4 h-4" />
                            <span>
                              {isEditingBlock
                                ? 'Approve & Execute Edited Block'
                                : '1-Click Approve & Execute'}
                            </span>
                          </button>

                          <button
                            onClick={() => {
                              if (!isEditingBlock) {
                                const initMap: Record<string, string> = {};
                                selectedEvent.stagedMutations.forEach((m) => {
                                  initMap[m.id] = JSON.stringify(m.args, null, 2);
                                });
                                setEditingMutations(initMap);
                              }
                              setIsEditingBlock(!isEditingBlock);
                            }}
                            className="px-3.5 py-2 border border-[#1F2937] bg-[#111827] hover:border-slate-600 text-xs font-medium text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>{isEditingBlock ? 'Cancel Edit' : 'Edit Staged Parameters'}</span>
                          </button>
                        </div>

                        <button
                          onClick={() => handleDistillViaKaggle(selectedEvent.eventId)}
                          disabled={runningKaggleJob}
                          className="px-3.5 py-2 border border-[#1F2937] bg-[#111827] hover:border-[#2563EB] text-xs font-medium text-[#9CA3AF] hover:text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Cpu className="w-3.5 h-3.5 text-[#2563EB]" />
                          <span>
                            {runningKaggleJob
                              ? 'Distilling on Kaggle GPU...'
                              : 'Distill Trajectory to Playbook (Kaggle GPU)'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =====================================================================
              MODULE 2: MCP SERVER SURFACE & RBAC BOUNDARY INSPECTOR
             ===================================================================== */}
          {activeModule === 'mcp' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
                <div>
                  <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
                    02. MCP Tool Surface &amp; Protocol Security Boundary (6 Servers · 28 Tools)
                  </h1>
                  <p className="text-xs text-[#9CA3AF] mt-1">
                    Every tool call is validated against strict Draft-07 JSON Schema, granular RBAC role policies, and read-only SQL AST guards before execution.
                  </p>
                </div>

                {/* Interactive Filter Tabs for the 6 MCP Servers */}
                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg">
                  <button
                    onClick={() => setSelectedServerFilter('all')}
                    className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                      selectedServerFilter === 'all'
                        ? 'bg-[#2563EB] text-white'
                        : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                    }`}
                  >
                    All (28)
                  </button>
                  {state.mcpServers.map((srv) => (
                    <button
                      key={srv.id}
                      onClick={() => setSelectedServerFilter(srv.id)}
                      className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                        selectedServerFilter === srv.id
                          ? 'bg-[#2563EB] text-white'
                          : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                      }`}
                    >
                      {srv.id.replace('-mcp', '')} ({srv.toolCount})
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left 5 Cols: Deterministic Tool Directory */}
                <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-4 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={toolSearchQuery}
                      onChange={(e) => setToolSearchQuery(e.target.value)}
                      placeholder="Filter 28 tools by name or description..."
                      className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md pl-9 pr-3 py-2 text-xs text-[#F9FAFB]"
                    />
                  </div>

                  <div className="max-h-[600px] overflow-y-auto divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                    {filteredTools.map((tool) => {
                      const active = tool.name === selectedTool.name;
                      const callerPermitted = tool.allowedRoles.includes(callerRole);
                      return (
                        <button
                          key={tool.name}
                          onClick={() => handleSelectTool(tool.name)}
                          className={`w-full text-left p-3 transition-colors cursor-pointer block ${
                            active ? 'bg-[#111827]' : 'hover:bg-[#111827]/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-mono">
                            <span className={active ? 'text-[#2563EB] font-semibold' : 'text-[#F9FAFB]'}>
                              {tool.name}
                            </span>
                            <span className={tool.isMutation ? 'text-[#D97706]' : 'text-[#9CA3AF]'}>
                              {tool.isMutation ? 'MUTATION' : 'READ-ONLY'}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#9CA3AF] mt-1 line-clamp-1">
                            {tool.description}
                          </div>
                          <div className="text-[11px] font-mono text-[#9CA3AF] mt-1.5 flex items-center justify-between">
                            <span>{tool.serverId}</span>
                            <span className={callerPermitted ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                              {callerPermitted ? `RBAC: ${callerRole} OK` : `RBAC: Denied for ${callerRole}`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right 7 Cols: Tool Schema & Live JSON-RPC Boundary Tester */}
                <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-6 space-y-5">
                  <div className="border-b border-[#1F2937] pb-4 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                      <div>
                        <span className="text-[#2563EB] font-semibold">{selectedTool.serverId}</span>
                        <span className="mx-2 text-[#9CA3AF]">·</span>
                        <span className="text-[#F9FAFB] font-semibold">{selectedTool.name}</span>
                      </div>
                      <span className={selectedTool.isMutation ? 'text-[#D97706]' : 'text-[#16A34A]'}>
                        {selectedTool.isMutation ? 'MUTATION_GATE_ACTIVE' : 'DETERMINISTIC_READ_ONLY'}
                      </span>
                    </div>
                    <p className="text-xs text-[#9CA3AF]">{selectedTool.description}</p>
                    <div className="text-xs font-mono text-[#9CA3AF] pt-1">
                      Permitted RBAC Roles: {selectedTool.allowedRoles.join(' · ')}
                    </div>
                  </div>

                  {/* 1-Click Boundary Security Verification Presets */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#9CA3AF]">
                      1-Click Boundary Enforcement Verification Presets:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          handleDispatchMCPTool(
                            'sql_execute_readonly_query',
                            DEFAULT_TOOL_ARGS['sql_execute_readonly_query'],
                            'readonly_analyst'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#16A34A] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
                      >
                        1. Valid Read-Only SQL
                      </button>
                      <button
                        onClick={() =>
                          handleDispatchMCPTool(
                            'infra_trigger_canary_rollback',
                            { deploy_id: 'dep-9042', reason: 'Attempted rollback by analyst' },
                            'readonly_analyst'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#DC2626] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
                      >
                        2. Test RBAC Violation (403)
                      </button>
                      <button
                        onClick={() =>
                          handleDispatchMCPTool(
                            'sql_execute_readonly_query',
                            { query: 'SELECT * FROM deployments', row_limit: 9999, injected_field: true },
                            'sre_admin'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#D97706] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
                      >
                        3. Test JSON Schema Violation (-32602)
                      </button>
                      <button
                        onClick={() =>
                          handleDispatchMCPTool(
                            'sql_execute_readonly_query',
                            { query: "DROP TABLE deployments; --" },
                            'sre_admin'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#DC2626] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
                      >
                        4. Test SQL DML/DDL Block
                      </button>
                    </div>
                  </div>

                  {/* JSON Schema & Request Arguments Editor */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        Enforced JSON Schema (Draft-07)
                      </div>
                      <pre className="p-3 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] overflow-x-auto h-52">
                        {JSON.stringify(selectedTool.inputSchema, null, 2)}
                      </pre>
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF] mb-1.5">
                        <span>JSON-RPC 2.0 Call Arguments</span>
                        <span className="font-mono text-[#F9FAFB]">Role: {callerRole}</span>
                      </div>
                      <textarea
                        value={rpcArgsText}
                        onChange={(e) => setRpcArgsText(e.target.value)}
                        className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded p-3 font-mono text-xs text-[#F9FAFB] h-52"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs font-mono text-[#9CA3AF]">
                      POST /api/mcp/rpc · method=&quot;tools/call&quot;
                    </div>
                    <button
                      onClick={() => handleDispatchMCPTool()}
                      disabled={executingRpc}
                      className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{executingRpc ? 'Executing RPC...' : `Invoke ${selectedTool.name}`}</span>
                    </button>
                  </div>

                  {/* JSON-RPC Wire Response Output */}
                  {rpcResponse && (
                    <div className="space-y-1.5 pt-2 border-t border-[#1F2937]">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span
                          className={
                            rpcResponse.status === 'SUCCESS' ? 'text-[#16A34A] font-semibold' : 'text-[#DC2626] font-semibold'
                          }
                        >
                          BOUNDARY STATUS: {rpcResponse.status} (HTTP {rpcResponse.httpCode})
                        </span>
                        {rpcResponse.wireFrame && (
                          <span className="tabular-nums text-[#9CA3AF]">
                            Latency: {rpcResponse.wireFrame.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <pre className="p-3.5 rounded bg-[#0B0F17] border border-[#1F2937] text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-64">
                        {JSON.stringify(rpcResponse.result || rpcResponse.error, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              MODULE 3: TWO-TIER SHARED MEMORY & KAGGLE GPU PLAYBOOK EXTRACTOR
             ===================================================================== */}
          {activeModule === 'memory' && (
            <div className="space-y-6">
              <div className="border-b border-[#1F2937] pb-4">
                <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
                  03. Two-Tier Shared Memory (pgvector + Redis) &amp; Kaggle GPU Playbook Extractor
                </h1>
                <p className="text-xs text-[#9CA3AF] mt-1">
                  Distills successful multi-step agent trajectories into reusable Markdown skills on Kaggle GPU and dynamically injects them into the system prompt via cosine similarity—reducing steps-to-completion by {state.metrics.avgStepReductionPct}%.
                </p>
              </div>

              {/* Top Split: Semantic Vector Search & Prompt Injector + Kaggle GPU Compute Bridge */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Left 7 Cols: Live pgvector Semantic Playbook Search */}
                <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#F9FAFB]">
                      Tier-2 pgvector Semantic Similarity Search &amp; Prompt Skill Injector
                    </h2>
                    <span className="text-xs font-mono text-[#9CA3AF]">
                      gemini-embedding-2-preview
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={semanticQuery}
                      onChange={(e) => setSemanticQuery(e.target.value)}
                      placeholder="Enter incoming incident query to compute cosine similarity..."
                      className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
                    />
                    <button
                      onClick={() => handleRunSemanticSearch()}
                      disabled={searchingMemory}
                      className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {searchingMemory ? 'Embedding...' : 'Search pgvector'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF]">
                    <span>Sample Queries:</span>
                    <button
                      onClick={() =>
                        handleRunSemanticSearch(
                          'PgBouncer connection pool exhaustion 98% FOR UPDATE lock on checkout-ledger-svc'
                        )
                      }
                      className="underline hover:text-[#F9FAFB] cursor-pointer"
                    >
                      PgBouncer Lock Contention
                    </button>
                    <span>·</span>
                    <button
                      onClick={() =>
                        handleRunSemanticSearch(
                          'EU cross-region webhook ETIMEDOUT TLS handshake 400ms on webhook-dispatcher-v2'
                        )
                      }
                      className="underline hover:text-[#F9FAFB] cursor-pointer"
                    >
                      Webhook TLS Timeout
                    </button>
                    <span>·</span>
                    <button
                      onClick={() =>
                        handleRunSemanticSearch('PostgreSQL read replica WAL replay lag degraded')
                      }
                      className="underline hover:text-[#F9FAFB] cursor-pointer"
                    >
                      Replica WAL Lag
                    </button>
                  </div>

                  {semanticSearchRes && (
                    <div className="space-y-3 pt-2 border-t border-[#1F2937]">
                      <div className="text-xs font-mono text-[#9CA3AF] tabular-nums">
                        Model: {semanticSearchRes.embeddingModelUsed} · Query Vector [0..7]: [{semanticSearchRes.queryVectorPreview.join(', ')}]
                      </div>
                      <div className="space-y-2">
                        {semanticSearchRes.matches.map((m: any) => (
                          <div
                            key={m.playbook.id}
                            className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] flex items-center justify-between text-xs font-mono"
                          >
                            <div>
                              <span className="text-[#F9FAFB] font-semibold">{m.playbook.id}</span>
                              <span className="mx-2 text-[#9CA3AF]">·</span>
                              <span className="text-[#9CA3AF] font-sans">{m.playbook.title}</span>
                            </div>
                            <div className="tabular-nums shrink-0">
                              <span className="text-[#16A34A]">sim={m.cosineSimilarity}</span>
                              <span className="mx-2 text-[#9CA3AF]">·</span>
                              <span>-{m.playbook.stepReductionPct}% steps</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-[#9CA3AF] mb-1">
                          Dynamically Constructed System Prompt Preview:
                        </div>
                        <pre className="p-3 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#F9FAFB] overflow-x-auto whitespace-pre-wrap">
                          {semanticSearchRes.constructedSystemPrompt}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right 5 Cols: Kaggle GPU Playbook Extractor Bridge */}
                <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#F9FAFB]">
                      Kaggle GPU Trajectory Distiller Bridge
                    </h2>
                    <span className="text-xs font-mono text-[#D97706]">NVIDIA_T4_X2</span>
                  </div>
                  <p className="text-xs text-[#9CA3AF] leading-relaxed">
                    Offloads batch trajectory distillation and high-dimensional vectorization to Kaggle GPU kernels, converting raw multi-step traces into deterministic Markdown skills.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-[#9CA3AF] mb-1">Target Service</label>
                      <select
                        value={distillService}
                        onChange={(e) => setDistillService(e.target.value)}
                        className="w-full bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs font-mono text-[#F9FAFB]"
                      >
                        <option value="checkout-ledger-svc">checkout-ledger-svc</option>
                        <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
                        <option value="auth-token-gateway">auth-token-gateway</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[#9CA3AF] mb-1">
                        Trajectory Context to Distill
                      </label>
                      <textarea
                        rows={2}
                        value={distillSummary}
                        onChange={(e) => setDistillSummary(e.target.value)}
                        className="w-full bg-[#0B0F17] border border-[#1F2937] rounded p-2.5 text-xs text-[#F9FAFB]"
                      />
                    </div>
                    <button
                      onClick={() => handleDistillViaKaggle()}
                      disabled={runningKaggleJob}
                      className="w-full py-2 px-4 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {runningKaggleJob
                        ? 'Running Kaggle GPU Distillation Kernel...'
                        : 'Run Playbook Extractor on Kaggle GPU'}
                    </button>
                  </div>

                  <div className="pt-3 border-t border-[#1F2937] space-y-2">
                    <div className="text-xs font-semibold text-[#9CA3AF]">
                      Recent Kaggle GPU Distillation Jobs ({state.kaggleGpuJobs.length})
                    </div>
                    {state.kaggleGpuJobs.slice(0, 3).map((job) => (
                      <div
                        key={job.jobId}
                        className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] text-xs font-mono space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[#F9FAFB] font-semibold">{job.jobId}</span>
                          <span className="text-[#16A34A] tabular-nums">
                            {job.rawStepCount} → {job.distilledStepCount} steps (-{job.stepReductionPct}%)
                          </span>
                        </div>
                        <div className="text-[11px] text-[#9CA3AF] truncate">
                          Kernel: {job.kernelSlug} · {job.accelerator} · {job.computeDurationMs}ms
                        </div>
                        <div className="text-[11px] text-[#2563EB]">
                          Extracted Skill: {job.extractedPlaybookId}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tier-2 pgvector Playbook Vault Table & Tier-1 Redis Hot Cache */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
                  <div className="text-sm font-semibold text-[#F9FAFB]">
                    Tier-2 PostgreSQL / pgvector Playbook Vault ({state.pgvectorPlaybooks.length} Skills Indexed)
                  </div>
                  <div className="space-y-3">
                    {state.pgvectorPlaybooks.map((pb) => (
                      <div
                        key={pb.id}
                        className="p-4 rounded border border-[#1F2937] bg-[#0B0F17] space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                          <span className="text-[#2563EB] font-semibold">{pb.id}</span>
                          <span className="tabular-nums text-[#16A34A]">
                            Steps: {pb.baselineStepsWithoutPlaybook} → {pb.distilledStepsWithPlaybook} (-{pb.stepReductionPct}%) · Used {pb.usageCount}x
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[#F9FAFB]">{pb.title}</div>
                        <div className="text-xs font-mono text-[#9CA3AF]">
                          Trigger: {pb.triggerSignature}
                        </div>
                        <pre className="p-3 bg-[#111827] rounded border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] overflow-x-auto whitespace-pre-wrap">
                          {pb.markdownSkill}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
                  <div className="text-sm font-semibold text-[#F9FAFB]">
                    Tier-1 Redis Hot Session &amp; Approval Lock Store ({state.redisTier1.length} Keys)
                  </div>
                  <div className="space-y-2.5">
                    {state.redisTier1.map((entry) => (
                      <div
                        key={entry.key}
                        className="p-3.5 rounded border border-[#1F2937] bg-[#0B0F17] space-y-1.5 text-xs font-mono"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[#F9FAFB] font-semibold truncate">{entry.key}</span>
                          <span className="text-[#D97706] tabular-nums shrink-0">
                            TTL {entry.ttlSeconds}s
                          </span>
                        </div>
                        <pre className="text-[11px] text-[#9CA3AF] overflow-x-auto">
                          {JSON.stringify(entry.value, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              MODULE 4: LIVE CLI & JSON-RPC WIRE PROTOCOL INSPECTOR
             ===================================================================== */}
          {activeModule === 'cli' && (
            <div className="space-y-6">
              <div className="border-b border-[#1F2937] pb-4">
                <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
                  04. Live CLI Harness &amp; JSON-RPC 2.0 Wire Frame Inspector
                </h1>
                <p className="text-xs text-[#9CA3AF] mt-1">
                  Execute headless MonoPulse CLI commands against the backend engine and inspect raw JSON-RPC 2.0 protocol frames.
                </p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left 7 Cols: Interactive CLI Terminal */}
                <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[#9CA3AF]">Quick CLI Commands:</span>
                    {[
                      'monopulse mcp list',
                      'monopulse rbac test-unauthorized',
                      'monopulse webhook emit ledger',
                      'monopulse memory search "PgBouncer lock"',
                      'monopulse kaggle distill evt-ambient-901'
                    ].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleRunCliCommand(preset)}
                        className="px-2.5 py-1 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#2563EB] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRunCliCommand();
                    }}
                    className="flex gap-2"
                  >
                    <div className="flex-1 flex items-center bg-[#0B0F17] border border-[#1F2937] rounded-md px-3">
                      <span className="text-xs font-mono text-[#2563EB] mr-2">$</span>
                      <input
                        type="text"
                        value={cliInput}
                        onChange={(e) => setCliInput(e.target.value)}
                        className="w-full py-2 bg-transparent font-mono text-xs text-[#F9FAFB] focus:outline-none"
                        placeholder="monopulse mcp call sql_inspect_table_schema '{&quot;table_name&quot;:&quot;deployments&quot;}'"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={runningCli}
                      className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap"
                    >
                      {runningCli ? 'Running...' : 'Execute'}
                    </button>
                  </form>

                  <div className="space-y-3 max-h-[520px] overflow-y-auto">
                    {cliHistory.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded border border-[#1F2937] bg-[#0B0F17] font-mono text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between text-[#9CA3AF]">
                          <span className="text-[#F9FAFB] font-semibold">$ {item.command}</span>
                          <span className="tabular-nums">
                            exit={item.exitCode} · {item.timestamp}
                          </span>
                        </div>
                        <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap overflow-x-auto leading-relaxed">
                          {item.output}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right 5 Cols: Live JSON-RPC 2.0 Wire Log */}
                <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#F9FAFB]">
                      JSON-RPC 2.0 Protocol Wire Frames ({state.wireLog.length})
                    </h2>
                    <span className="text-xs font-mono text-[#9CA3AF]">stdio/http-rpc</span>
                  </div>

                  {state.wireLog.length === 0 ? (
                    <div className="p-6 border border-[#1F2937] bg-[#0B0F17] rounded text-center space-y-2">
                      <p className="text-xs text-[#9CA3AF]">
                        No MCP tool frames recorded in this session yet.
                      </p>
                      <button
                        onClick={() => handleRunCliCommand('monopulse rbac test-unauthorized')}
                        className="px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded cursor-pointer"
                      >
                        Generate Sample Wire Frames
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[560px] overflow-y-auto">
                      {state.wireLog.map((wf) => (
                        <div
                          key={wf.frameId}
                          className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] text-xs font-mono space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[#F9FAFB] font-semibold">{wf.toolName}</span>
                            <span
                              className={
                                wf.status === 'SUCCESS'
                                  ? 'text-[#16A34A]'
                                  : 'text-[#DC2626]'
                              }
                            >
                              {wf.status} · {wf.latencyMs}ms
                            </span>
                          </div>
                          <div className="text-[11px] text-[#9CA3AF]">
                            {wf.serverId} · role={wf.callerRole} · {wf.frameId}
                          </div>
                          <pre className="p-2 bg-[#111827] rounded text-[11px] text-[#9CA3AF] overflow-x-auto">
                            {JSON.stringify(
                              { req: wf.requestPayload, res: wf.responsePayload },
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
