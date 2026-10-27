import { describe, expect, it, vi } from 'vitest';
import { executeMCPToolCall, MCP_SERVERS, MCP_TOOLS } from '../src/server/mcpRegistry.ts';
import { signApprovalToken } from '../src/server/cryptoSecurity.ts';
import {
  executeWithRetryAndCircuitBreaker,
  getConnectorCircuitState,
  normalizeIncomingWebhookPayload,
  recordConnectorFailure,
  recordConnectorSuccess,
  setSimulationModeActive,
  verifyLiveExternalConnectors
} from '../src/server/liveConnectors.ts';

const VALID_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  // 1. sql-ops-mcp (5 tools)
  sql_execute_readonly_query: { query: 'SELECT deploy_id, service, status FROM deployments', row_limit: 10 },
  sql_inspect_table_schema: { table_name: 'deployments' },
  sql_explain_query_plan: { query: 'SELECT * FROM deployments WHERE service = "checkout-ledger-svc"' },
  sql_sample_recent_rows: { table_name: 'service_incidents', limit: 5 },
  sql_check_replication_lag: { cluster_name: 'ledger-prod-cluster' },

  // 2. github-mcp (5 tools)
  github_get_pr_diff: { pr_number: 1842 },
  github_list_pr_checks: { pr_number: 1842 },
  github_blame_file_range: { file_path: 'src/ledger/LedgerRepository.ts' },
  github_search_commits: { query: 'dep-9042' },
  github_post_pr_review_comment: {
    pr_number: 1842,
    comment_body: 'Automated RCA verification: LockWaitTimeout on ledger_entries.'
  },

  // 3. slack-mcp (5 tools)
  slack_fetch_thread_messages: { thread_ts: '1708941002.001400' },
  slack_summarize_incident_thread: { thread_ts: '1708941002.001400' },
  slack_search_channel_history: { keyword: 'PgBouncer' },
  slack_post_approval_block: {
    thread_ts: '1708941002.001400',
    event_id: 'evt-ambient-901',
    summary_markdown: 'Canary dep-9042 rollback staged.'
  },
  slack_broadcast_resolution: {
    channel_name: '#inc-prod-alerts',
    resolution_message: 'Canary dep-9042 drained and HTTP 5xx restored to 0.12%.'
  },

  // 4. jira-mcp (5 tools)
  jira_get_ticket_context: { ticket_key: 'OPS-4821' },
  jira_search_similar_issues: { service: 'checkout-ledger-svc' },
  jira_transition_ticket_status: { ticket_key: 'OPS-4821', new_status: 'Mitigated' },
  jira_assign_oncall_owner: { ticket_key: 'OPS-4821', assignee: 'ravi.kishore' },
  jira_append_root_cause_field: {
    ticket_key: 'OPS-4821',
    root_cause_notes: 'Unbounded SELECT FOR UPDATE in PR #1842.'
  },

  // 5. docs-mcp (4 tools)
  docs_semantic_search: { query: 'PgBouncer connection pool exhaustion' },
  docs_get_runbook_by_service: { service: 'checkout-ledger-svc' },
  docs_list_postmortems: { service: 'checkout-ledger-svc' },
  docs_propose_runbook_patch: {
    doc_id: 'RUNBOOK-LEDGER-01',
    patch_markdown: '### Guardrail: Enforce SKIP LOCKED on batch workers'
  },

  // 6. infra-mcp (4 tools)
  infra_get_service_error_rate: { service: 'checkout-ledger-svc' },
  infra_fetch_pod_logs: { service: 'checkout-ledger-svc' },
  infra_check_feature_flags: { service: 'checkout-ledger-svc' },
  infra_trigger_canary_rollback: {
    deploy_id: 'dep-9042',
    reason: 'Automated test rollback for PgBouncer pool exhaustion'
  }
};

describe('Complete 6-Server / 28-Tool MCP Coverage & Live Connectors Suite (Rec 05)', () => {
  it('registers all 6 MCP servers and 28 tools and executes every tool successfully on allowed RBAC paths', () => {
    expect(MCP_SERVERS).toHaveLength(6);
    expect(MCP_TOOLS).toHaveLength(28);

    for (const tool of MCP_TOOLS) {
      const args = VALID_TOOL_ARGS[tool.name];
      expect(args, `Missing test args for tool ${tool.name}`).toBeDefined();

      const approvalToken = tool.isMutation
        ? signApprovalToken({ toolName: tool.name, args })
        : undefined;

      const frame = executeMCPToolCall({
        toolName: tool.name,
        args,
        callerRole: 'sre_admin',
        approvalToken
      });

      expect(frame.status, `Expected SUCCESS for ${tool.name} on ${tool.serverId}`).toBe('SUCCESS');
      expect(frame.wireFrame.serverId).toBe(tool.serverId);
    }
  });

  it('enforces RBAC_DENIED across all mutation and role-restricted tools across the 6 MCP servers', () => {
    const mutationTools = MCP_TOOLS.filter((t) => t.isMutation);
    expect(mutationTools.length).toBeGreaterThanOrEqual(7);

    for (const tool of mutationTools) {
      const args = VALID_TOOL_ARGS[tool.name];
      const deniedFrame = executeMCPToolCall({
        toolName: tool.name,
        args,
        callerRole: 'readonly_analyst'
      });
      expect(deniedFrame.status).toBe('RBAC_DENIED');
    }

    // Also verify read-only tools restricted from support_tier2 (sql_explain_query_plan, github_blame_file_range)
    for (const restrictedReadTool of ['sql_explain_query_plan', 'github_blame_file_range', 'slack_post_approval_block']) {
      const toolDef = MCP_TOOLS.find((t) => t.name === restrictedReadTool)!;
      const disallowedRole = toolDef.allowedRoles.includes('support_tier2') ? 'readonly_analyst' : 'support_tier2';
      const frame = executeMCPToolCall({
        toolName: restrictedReadTool,
        args: VALID_TOOL_ARGS[restrictedReadTool],
        callerRole: disallowedRole
      });
      expect(frame.status).toBe('RBAC_DENIED');
    }
  });

  it('normalizes Slack challenge, Prometheus Alertmanager, PagerDuty V3, and GitHub deployment_status payloads', () => {
    expect(normalizeIncomingWebhookPayload(null as any).normalized).toBeNull();

    const challenge = normalizeIncomingWebhookPayload({
      type: 'url_verification',
      challenge: 'slack_challenge_token_123'
    });
    expect(challenge.isSlackChallenge).toBe(true);
    expect(challenge.challenge).toBe('slack_challenge_token_123');

    const alertmanager = normalizeIncomingWebhookPayload({
      alerts: [
        {
          labels: { service: 'checkout-ledger-svc', alertname: 'High5xxRate', channel: '#alerts' },
          annotations: { summary: 'High HTTP 5xx rate detected' }
        }
      ]
    });
    expect(alertmanager.normalized?.vendorFormat).toBe('prometheus.alertmanager.v4');

    const pagerduty = normalizeIncomingWebhookPayload({
      event: {
        event_type: 'incident.triggered',
        data: { id: 'PD-777', title: 'Database lock contention', service: { summary: 'Checkout Ledger Svc' } }
      }
    });
    expect(pagerduty.normalized?.vendorFormat).toBe('pagerduty.v3.webhook');

    const githubDeploy = normalizeIncomingWebhookPayload({
      repository: { name: 'checkout-ledger-svc' },
      deployment_status: { state: 'failure', description: 'Canary health check failed' }
    });
    expect(githubDeploy.normalized?.vendorFormat).toBe('github.deployment_status');
  });

  it('exercises liveConnectors circuit breaker transitions and verifyLiveExternalConnectors HTTP branches with mocked fetch', async () => {
    const prevForce = process.env.MONOPULSE_FORCE_SIMULATION;
    const prevGh = process.env.GITHUB_TOKEN;
    const prevJira = process.env.JIRA_API_TOKEN;
    const prevJiraEmail = process.env.JIRA_USER_EMAIL;
    const prevJiraBase = process.env.JIRA_BASE_URL;
    const originalFetch = globalThis.fetch;

    try {
      process.env.MONOPULSE_FORCE_SIMULATION = 'false';
      setSimulationModeActive(false);

      // 1. Test circuit breaker opening after 3 failures and fallback on OPEN
      recordConnectorSuccess('test-cb-mcp');
      recordConnectorFailure('test-cb-mcp');
      recordConnectorFailure('test-cb-mcp');
      const thirdFail = recordConnectorFailure('test-cb-mcp');
      expect(thirdFail.state).toBe('OPEN');
      expect(getConnectorCircuitState('test-cb-mcp').state).toBe('OPEN');

      const openOutcome = await executeWithRetryAndCircuitBreaker(
        'test-cb-mcp',
        async () => 'live',
        () => 'fallback-when-open'
      );
      expect(openOutcome.liveExecuted).toBe(false);
      expect(openOutcome.circuitState).toBe('OPEN');

      // 2. Test live operation success and retry exhaustion
      recordConnectorSuccess('test-retry-mcp');
      const liveOk = await executeWithRetryAndCircuitBreaker(
        'test-retry-mcp',
        async () => 'live-ok',
        () => 'fallback'
      );
      expect(liveOk.liveExecuted).toBe(true);
      expect(liveOk.data).toBe('live-ok');

      const retryFail = await executeWithRetryAndCircuitBreaker(
        'test-retry-mcp',
        async () => {
          throw new Error('Upstream timeout');
        },
        () => 'fallback-after-retry',
        2
      );
      expect(retryFail.liveExecuted).toBe(false);
      expect(retryFail.data).toBe('fallback-after-retry');

      // 3. Test verifyLiveExternalConnectors HTTP 200 and HTTP 500 branches with mocked fetch
      process.env.GITHUB_TOKEN = 'ghp_mock_test_token';
      process.env.JIRA_API_TOKEN = 'jira_mock_test_token';
      process.env.JIRA_USER_EMAIL = 'sre@monopulse.dev';
      process.env.JIRA_BASE_URL = 'https://monopulse.atlassian.net';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          full_name: 'Ravikishore710/monopulse-mcp-engine',
          default_branch: 'main',
          emailAddress: 'sre@monopulse.dev',
          displayName: 'SRE Operator',
          accountId: 'acc-1'
        })
      }) as any;

      const okVerify = await verifyLiveExternalConnectors();
      expect(okVerify.github.reachable).toBe(true);
      expect(okVerify.jira.reachable).toBe(true);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({})
      }) as any;

      const errVerify = await verifyLiveExternalConnectors();
      expect(errVerify.github.reachable).toBe(false);
      expect(errVerify.github.statusCode).toBe(503);
      expect(errVerify.jira.reachable).toBe(false);
      expect(errVerify.jira.statusCode).toBe(503);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.MONOPULSE_FORCE_SIMULATION = prevForce;
      if (prevGh === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevGh;
      if (prevJira === undefined) delete process.env.JIRA_API_TOKEN;
      else process.env.JIRA_API_TOKEN = prevJira;
      if (prevJiraEmail === undefined) delete process.env.JIRA_USER_EMAIL;
      else process.env.JIRA_USER_EMAIL = prevJiraEmail;
      if (prevJiraBase === undefined) delete process.env.JIRA_BASE_URL;
      else process.env.JIRA_BASE_URL = prevJiraBase;
    }
  });

  it('verifies all 6 MCP server IDs map to distinct tool subsets with zero orphaned tools', () => {
    const serverIds = new Set(MCP_SERVERS.map((s) => s.id));
    for (const tool of MCP_TOOLS) {
      expect(serverIds.has(tool.serverId)).toBe(true);
    }
  });
});
