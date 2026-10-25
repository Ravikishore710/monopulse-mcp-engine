import { MCPToolDefinition, RBACRole } from './mcpTypes.ts';

const ALL_ROLES: RBACRole[] = ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'];
const WRITE_ROLES: RBACRole[] = ['sre_admin', 'eng_lead', 'support_tier2'];
const LEAD_ROLES: RBACRole[] = ['sre_admin', 'eng_lead'];
const SQL_TABLE_ENUM = [
  'deployments',
  'service_incidents',
  'customer_orgs',
  'feature_flags',
  'db_replication_status'
];
const SERVICE_ENUM = ['checkout-ledger-svc', 'webhook-dispatcher-v2', 'auth-token-gateway'];

export const MCP_TOOLS: MCPToolDefinition[] = [
  // 1. sql-ops-mcp (5 tools)
  {
    name: 'sql_execute_readonly_query',
    serverId: 'sql-ops-mcp',
    description:
      'Executes a deterministic SELECT query against the production read-replica. Rejects any INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE statements.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Read-only SQL SELECT statement' },
        row_limit: { type: 'integer', description: 'Max rows (1-250)', minimum: 1, maximum: 250 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_inspect_table_schema',
    serverId: 'sql-ops-mcp',
    description: 'Returns column names, SQL data types, nullability, and descriptions for a production table.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Target table name', enum: SQL_TABLE_ENUM }
      },
      required: ['table_name'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_explain_query_plan',
    serverId: 'sql-ops-mcp',
    description: 'Runs EXPLAIN on a candidate SQL query to detect sequential scans or lock contention.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to analyze' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_sample_recent_rows',
    serverId: 'sql-ops-mcp',
    description: 'Fetches a bounded snapshot of recent rows from a specified table.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Table name to sample', enum: SQL_TABLE_ENUM },
        limit: { type: 'integer', description: 'Max sample rows', minimum: 1, maximum: 50 }
      },
      required: ['table_name'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_check_replication_lag',
    serverId: 'sql-ops-mcp',
    description: 'Inspects PostgreSQL WAL replication lag and active lock counts across replica nodes.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        cluster_name: { type: 'string', description: 'Cluster identifier (e.g. ledger-prod-cluster)' }
      },
      required: ['cluster_name'],
      additionalProperties: false
    }
  },

  // 2. github-mcp (5 tools)
  {
    name: 'github_get_pr_diff',
    serverId: 'github-mcp',
    description: 'Retrieves the unified diff, author, branch, and touched files for a GitHub PR.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'GitHub Pull Request number' }
      },
      required: ['pr_number'],
      additionalProperties: false
    }
  },
  {
    name: 'github_list_pr_checks',
    serverId: 'github-mcp',
    description: 'Lists CI/CD check suite statuses and failure log excerpts for a Pull Request.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'GitHub Pull Request number' }
      },
      required: ['pr_number'],
      additionalProperties: false
    }
  },
  {
    name: 'github_blame_file_range',
    serverId: 'github-mcp',
    description: 'Returns commit blame metadata for a specific source file path.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Repository relative file path' }
      },
      required: ['file_path'],
      additionalProperties: false
    }
  },
  {
    name: 'github_search_commits',
    serverId: 'github-mcp',
    description: 'Searches recent repository commits by service keyword or SHA prefix.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Commit search query or SHA' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'github_post_pr_review_comment',
    serverId: 'github-mcp',
    description: 'MUTATION: Posts an automated root-cause annotation onto a GitHub Pull Request.',
    isMutation: true,
    allowedRoles: LEAD_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'Target Pull Request number' },
        comment_body: { type: 'string', description: 'Markdown comment body' }
      },
      required: ['pr_number', 'comment_body'],
      additionalProperties: false
    }
  },

  // 3. slack-mcp (5 tools)
  {
    name: 'slack_fetch_thread_messages',
    serverId: 'slack-mcp',
    description: 'Fetches all chronological messages and responder roles from a Slack thread.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        thread_ts: { type: 'string', description: 'Slack thread timestamp ID' }
      },
      required: ['thread_ts'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_summarize_incident_thread',
    serverId: 'slack-mcp',
    description: 'Extracts timeline signals, mentioned PR numbers, and affected tenants from a thread.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        thread_ts: { type: 'string', description: 'Slack thread timestamp ID' }
      },
      required: ['thread_ts'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_search_channel_history',
    serverId: 'slack-mcp',
    description: 'Searches across Slack incident and escalation channels for matching error signatures.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search keyword' }
      },
      required: ['keyword'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_post_approval_block',
    serverId: 'slack-mcp',
    description: 'Stages an Ambient 1-Click Approve/Edit interactive summary block in Slack.',
    isMutation: false,
    allowedRoles: WRITE_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        thread_ts: { type: 'string', description: 'Target Slack thread timestamp' },
        event_id: { type: 'string', description: 'MonoPulse ambient event ID' },
        summary_markdown: { type: 'string', description: 'Pre-computed root cause summary' }
      },
      required: ['thread_ts', 'event_id', 'summary_markdown'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_broadcast_resolution',
    serverId: 'slack-mcp',
    description: 'MUTATION: Broadcasts an official incident mitigation confirmation message to Slack.',
    isMutation: true,
    allowedRoles: WRITE_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        channel_name: { type: 'string', description: 'Target channel (e.g. #inc-prod-alerts)' },
        resolution_message: { type: 'string', description: 'Verified resolution details' }
      },
      required: ['channel_name', 'resolution_message'],
      additionalProperties: false
    }
  },

  // 4. jira-mcp (5 tools)
  {
    name: 'jira_get_ticket_context',
    serverId: 'jira-mcp',
    description: 'Fetches full Jira issue metadata, SLA countdown, priority, and description.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira issue key (e.g. OPS-4821)' }
      },
      required: ['ticket_key'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_search_similar_issues',
    serverId: 'jira-mcp',
    description: 'Searches Jira history for tickets affecting the same microservice.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Microservice name' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_transition_ticket_status',
    serverId: 'jira-mcp',
    description: 'MUTATION: Transitions a Jira ticket status (Open -> Investigating -> Mitigated -> Resolved).',
    isMutation: true,
    allowedRoles: WRITE_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key' },
        new_status: {
          type: 'string',
          description: 'Target workflow state',
          enum: ['Open', 'Investigating', 'Mitigated', 'Resolved']
        }
      },
      required: ['ticket_key', 'new_status'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_assign_oncall_owner',
    serverId: 'jira-mcp',
    description: 'MUTATION: Updates the Jira ticket assignee to the responsible engineer.',
    isMutation: true,
    allowedRoles: WRITE_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key' },
        assignee: { type: 'string', description: 'Username of engineer' }
      },
      required: ['ticket_key', 'assignee'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_append_root_cause_field',
    serverId: 'jira-mcp',
    description: 'MUTATION: Writes verified root-cause forensics into the Jira ticket RCA field.',
    isMutation: true,
    allowedRoles: LEAD_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key' },
        root_cause_notes: { type: 'string', description: 'Structured RCA summary' }
      },
      required: ['ticket_key', 'root_cause_notes'],
      additionalProperties: false
    }
  },

  // 5. docs-mcp (4 tools)
  {
    name: 'docs_semantic_search',
    serverId: 'docs-mcp',
    description: 'Searches internal engineering runbooks and postmortems by symptom or keyword.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symptom or keyword query' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'docs_get_runbook_by_service',
    serverId: 'docs-mcp',
    description: 'Retrieves the canonical operational runbook for a given microservice.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Microservice identifier' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'docs_list_postmortems',
    serverId: 'docs-mcp',
    description: 'Lists historical incident postmortems to cross-reference failure modes.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service filter' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'docs_propose_runbook_patch',
    serverId: 'docs-mcp',
    description: 'MUTATION: Appends a newly discovered remediation guardrail patch to an internal runbook.',
    isMutation: true,
    allowedRoles: LEAD_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string', description: 'Document ID (e.g. RUNBOOK-LEDGER-01)' },
        patch_markdown: { type: 'string', description: 'Markdown section to append' }
      },
      required: ['doc_id', 'patch_markdown'],
      additionalProperties: false
    }
  },

  // 6. infra-mcp (4 tools)
  {
    name: 'infra_get_service_error_rate',
    serverId: 'infra-mcp',
    description: 'Returns real-time HTTP 5xx error rate, p99 latency, and active canary ID.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name', enum: SERVICE_ENUM }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'infra_fetch_pod_logs',
    serverId: 'infra-mcp',
    description: 'Fetches recent structured error and warning log lines from Kubernetes pods.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name', enum: SERVICE_ENUM }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'infra_check_feature_flags',
    serverId: 'infra-mcp',
    description: 'Lists active feature flags and rollout percentages targeting a microservice.',
    isMutation: false,
    allowedRoles: ALL_ROLES,
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Microservice name' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'infra_trigger_canary_rollback',
    serverId: 'infra-mcp',
    description: 'MUTATION: Drains traffic from an unhealthy canary deployment and restores 100% stable routing.',
    isMutation: true,
    allowedRoles: ['sre_admin'],
    inputSchema: {
      type: 'object',
      properties: {
        deploy_id: { type: 'string', description: 'Canary deployment ID (e.g. dep-9042)' },
        reason: { type: 'string', description: 'Audit reason for canary rollback' }
      },
      required: ['deploy_id', 'reason'],
      additionalProperties: false
    }
  }
];
