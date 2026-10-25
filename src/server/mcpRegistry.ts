import {
  SQL_TABLES,
  GITHUB_PRS,
  SLACK_THREADS,
  JIRA_TICKETS,
  INTERNAL_DOCS,
  POD_TELEMETRY,
  JiraTicket
} from './sandboxData.ts';

export type RBACRole = 'sre_admin' | 'eng_lead' | 'support_tier2' | 'readonly_analyst';

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export interface MCPToolDefinition {
  name: string;
  serverId: string;
  description: string;
  isMutation: boolean;
  allowedRoles: RBACRole[];
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface MCPServerMetadata {
  id: string;
  name: string;
  transport: 'json-rpc-2.0/stdio-bridge';
  version: string;
  domain: string;
  description: string;
  toolCount: number;
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

export const MCP_SERVERS: MCPServerMetadata[] = [
  {
    id: 'sql-ops-mcp',
    name: 'SQL Operations Read-Only Runner',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '2.4.0',
    domain: 'PostgreSQL / Production Read Replica',
    description: 'Deterministic read-only SQL introspection with AST/regex DDL & DML mutation blocking at the protocol boundary.',
    toolCount: 5
  },
  {
    id: 'github-mcp',
    name: 'GitHub PR & Commit Inspector',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '1.9.2',
    domain: 'GitHub Enterprise / CI Checks',
    description: 'Inspects pull request diffs, failing CI check logs, git blame ranges, and posts review annotations.',
    toolCount: 5
  },
  {
    id: 'slack-mcp',
    name: 'Slack Incident Thread & Block Bus',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '3.1.0',
    domain: 'Slack Events API & Block Kit',
    description: 'Summarizes noisy incident threads, searches historical channel logs, and dispatches 1-Click Approve/Edit blocks.',
    toolCount: 5
  },
  {
    id: 'jira-mcp',
    name: 'Jira Ticket Mutator & SLA Engine',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '2.2.1',
    domain: 'Jira Ops / Incident Tracking',
    description: 'Reads incident context and SLA timers; gates status transitions, root-cause writes, and on-call reassignments behind RBAC.',
    toolCount: 5
  },
  {
    id: 'docs-mcp',
    name: 'Internal Runbooks & Postmortem Vault',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '1.7.4',
    domain: 'Engineering Knowledge Base',
    description: 'Retrieves service remediation runbooks, historical postmortems, and stages runbook diff patches.',
    toolCount: 4
  },
  {
    id: 'infra-mcp',
    name: 'Kubernetes & Canary Telemetry Controller',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '4.0.1',
    domain: 'Service Mesh & Canary Rollouts',
    description: 'Streams pod error rates, p99 latencies, launch flags, and executes RBAC-gated canary rollbacks.',
    toolCount: 4
  }
];

// All 28 deterministic tools across the 6 custom MCP servers
export const MCP_TOOLS: MCPToolDefinition[] = [
  // 1. sql-ops-mcp (5 tools)
  {
    name: 'sql_execute_readonly_query',
    serverId: 'sql-ops-mcp',
    description: 'Executes a deterministic SELECT query against the production read-replica. Rejects any INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE statements.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Read-only SQL SELECT statement targeting sandbox tables (deployments, service_incidents, customer_orgs, feature_flags, db_replication_status)' },
        row_limit: { type: 'integer', description: 'Maximum rows to return (1-250)', minimum: 1, maximum: 250 }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        table_name: {
          type: 'string',
          description: 'Target table name',
          enum: ['deployments', 'service_incidents', 'customer_orgs', 'feature_flags', 'db_replication_status']
        }
      },
      required: ['table_name'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_explain_query_plan',
    serverId: 'sql-ops-mcp',
    description: 'Runs EXPLAIN (FORMAT JSON, ANALYZE FALSE) on a candidate SQL query to detect sequential scans or lock contention.',
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
    description: 'Fetches a bounded snapshot of recent rows from a specified table without requiring raw SQL syntax.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        table_name: {
          type: 'string',
          description: 'Table name to sample',
          enum: ['deployments', 'service_incidents', 'customer_orgs', 'feature_flags', 'db_replication_status']
        },
        limit: { type: 'integer', description: 'Max sample rows', minimum: 1, maximum: 50 }
      },
      required: ['table_name'],
      additionalProperties: false
    }
  },
  {
    name: 'sql_check_replication_lag',
    serverId: 'sql-ops-mcp',
    description: 'Inspects PostgreSQL WAL replication lag and active lock counts across primary and read-replica nodes.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    description: 'Retrieves the unified diff, author, branch, and touched files for a specific GitHub Pull Request.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'GitHub Pull Request number (e.g. 1842 or 1835)' }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    description: 'Returns commit blame metadata for a specific source file path to identify recent regressions.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Repository relative file path (e.g. src/repository/LedgerRepository.ts)' }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    description: 'MUTATION: Posts an automated root-cause annotation or rollback notice onto a GitHub Pull Request.',
    isMutation: true,
    allowedRoles: ['sre_admin', 'eng_lead'],
    inputSchema: {
      type: 'object',
      properties: {
        pr_number: { type: 'integer', description: 'Target Pull Request number' },
        comment_body: { type: 'string', description: 'Markdown comment body explaining the regression' }
      },
      required: ['pr_number', 'comment_body'],
      additionalProperties: false
    }
  },

  // 3. slack-mcp (5 tools)
  {
    name: 'slack_fetch_thread_messages',
    serverId: 'slack-mcp',
    description: 'Fetches all chronological messages and responder roles from an incident or support Slack thread.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        thread_ts: { type: 'string', description: 'Slack thread timestamp ID (e.g. 1761406210.004200)' }
      },
      required: ['thread_ts'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_summarize_incident_thread',
    serverId: 'slack-mcp',
    description: 'Extracts timeline signals, mentioned PR numbers, and affected tenants from a Slack thread.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search keyword (e.g. PgBouncer, ETIMEDOUT, a8f31c9)' }
      },
      required: ['keyword'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_post_approval_block',
    serverId: 'slack-mcp',
    description: 'Stages a non-intrusive Ambient 1-Click Approve/Edit interactive summary block in the originating Slack thread.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2'],
    inputSchema: {
      type: 'object',
      properties: {
        thread_ts: { type: 'string', description: 'Target Slack thread timestamp' },
        event_id: { type: 'string', description: 'MonoPulse ambient event ID' },
        summary_markdown: { type: 'string', description: 'Pre-computed root cause and proposed 1-click actions' }
      },
      required: ['thread_ts', 'event_id', 'summary_markdown'],
      additionalProperties: false
    }
  },
  {
    name: 'slack_broadcast_resolution',
    serverId: 'slack-mcp',
    description: 'MUTATION: Broadcasts an official incident mitigation confirmation message to the incident channel.',
    isMutation: true,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2'],
    inputSchema: {
      type: 'object',
      properties: {
        channel_name: { type: 'string', description: 'Target channel (e.g. #inc-prod-alerts)' },
        resolution_message: { type: 'string', description: 'Verified resolution details and rollback confirmation' }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira issue key (e.g. OPS-4821 or OPS-4819)' }
      },
      required: ['ticket_key'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_search_similar_issues',
    serverId: 'jira-mcp',
    description: 'Searches Jira history for tickets affecting the same microservice or error signature.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Microservice name (e.g. checkout-ledger-svc)' }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2'],
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key (e.g. OPS-4821)' },
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
    description: 'MUTATION: Updates the Jira ticket assignee to the responsible engineer or on-call responder.',
    isMutation: true,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2'],
    inputSchema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key' },
        assignee: { type: 'string', description: 'Username of engineer (e.g. mchen, arivera, sre_oncall_dana)' }
      },
      required: ['ticket_key', 'assignee'],
      additionalProperties: false
    }
  },
  {
    name: 'jira_append_root_cause_field',
    serverId: 'jira-mcp',
    description: 'MUTATION: Writes verified root-cause forensics and git SHA references into the Jira ticket RCA field.',
    isMutation: true,
    allowedRoles: ['sre_admin', 'eng_lead'],
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
    description: 'Searches internal engineering runbooks and postmortems by symptom or error keyword.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Microservice identifier (e.g. checkout-ledger-svc)' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'docs_list_postmortems',
    serverId: 'docs-mcp',
    description: 'Lists historical incident postmortems to cross-reference recurring architectural failure modes.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Optional service filter' }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'docs_propose_runbook_patch',
    serverId: 'docs-mcp',
    description: 'MUTATION: Appends a newly discovered remediation step or guardrail patch to an internal runbook.',
    isMutation: true,
    allowedRoles: ['sre_admin', 'eng_lead'],
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string', description: 'Document ID (e.g. RUNBOOK-LEDGER-01)' },
        patch_markdown: { type: 'string', description: 'Markdown section to append to the runbook' }
      },
      required: ['doc_id', 'patch_markdown'],
      additionalProperties: false
    }
  },

  // 6. infra-mcp (4 tools)
  {
    name: 'infra_get_service_error_rate',
    serverId: 'infra-mcp',
    description: 'Returns real-time HTTP 5xx error rate, p99 latency, and active canary deployment ID for a service.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name',
          enum: ['checkout-ledger-svc', 'webhook-dispatcher-v2', 'auth-token-gateway']
        }
      },
      required: ['service'],
      additionalProperties: false
    }
  },
  {
    name: 'infra_fetch_pod_logs',
    serverId: 'infra-mcp',
    description: 'Fetches recent structured error and warning log lines from Kubernetes pods for a service.',
    isMutation: false,
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name',
          enum: ['checkout-ledger-svc', 'webhook-dispatcher-v2', 'auth-token-gateway']
        }
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
    allowedRoles: ['sre_admin', 'eng_lead', 'support_tier2', 'readonly_analyst'],
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
    description: 'MUTATION: Immediately drains traffic from an unhealthy canary deployment and restores 100% stable routing.',
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

export const WIRE_LOG: MCPWireFrame[] = [];

function recordWireFrame(frame: MCPWireFrame) {
  WIRE_LOG.unshift(frame);
  if (WIRE_LOG.length > 80) {
    WIRE_LOG.pop();
  }
}

/**
 * Deterministic JSON Schema Draft-07 Validator at the MCP Tool Boundary
 */
export function validateMCPToolSchema(
  tool: MCPToolDefinition,
  args: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, errors: ['Payload arguments must be a valid JSON object.'] };
  }

  // Check required fields
  for (const reqField of tool.inputSchema.required) {
    if (args[reqField] === undefined || args[reqField] === null || args[reqField] === '') {
      errors.push(`Missing required property '${reqField}'.`);
    }
  }

  // Check additionalProperties: false
  if (tool.inputSchema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!tool.inputSchema.properties[key]) {
        errors.push(`Unknown property '${key}' is not permitted by strict schema (additionalProperties: false).`);
      }
    }
  }

  // Check property types, enums, and bounds
  for (const [key, propSchema] of Object.entries(tool.inputSchema.properties)) {
    const val = args[key];
    if (val === undefined) continue;

    if (propSchema.type === 'string' && typeof val !== 'string') {
      errors.push(`Property '${key}' must be of type string (received ${typeof val}).`);
    } else if (propSchema.type === 'integer' && (!Number.isInteger(val) || typeof val !== 'number')) {
      errors.push(`Property '${key}' must be an integer (received ${JSON.stringify(val)}).`);
    } else if (propSchema.type === 'number' && typeof val !== 'number') {
      errors.push(`Property '${key}' must be a number (received ${typeof val}).`);
    } else if (propSchema.type === 'boolean' && typeof val !== 'boolean') {
      errors.push(`Property '${key}' must be a boolean (received ${typeof val}).`);
    }

    if (propSchema.enum && typeof val === 'string' && !propSchema.enum.includes(val)) {
      errors.push(`Property '${key}' value '${val}' violates enum constraint [${propSchema.enum.join(', ')}].`);
    }

    if (typeof val === 'number') {
      if (propSchema.minimum !== undefined && val < propSchema.minimum) {
        errors.push(`Property '${key}' (${val}) is below minimum ${propSchema.minimum}.`);
      }
      if (propSchema.maximum !== undefined && val > propSchema.maximum) {
        errors.push(`Property '${key}' (${val}) exceeds maximum ${propSchema.maximum}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Enforces JSON Schema validation, RBAC role authorization, and Read-Only SQL AST guards
 */
export function executeMCPToolCall(params: {
  toolName: string;
  args: Record<string, any>;
  callerRole: RBACRole;
  approvalToken?: string;
}): {
  jsonrpc: '2.0';
  id: string;
  status: 'SUCCESS' | 'RBAC_DENIED' | 'SCHEMA_INVALID' | 'SQL_MUTATION_BLOCKED';
  httpCode: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
  wireFrame: MCPWireFrame;
} {
  const start = Date.now();
  const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tool = MCP_TOOLS.find((t) => t.name === params.toolName);

  if (!tool) {
    const errorPayload = {
      code: -32601,
      message: `MCP Tool '${params.toolName}' not found in registered server surface.`
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: 'unknown',
      toolName: params.toolName,
      callerRole: params.callerRole,
      isMutation: false,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'SCHEMA_INVALID',
      latencyMs: Date.now() - start,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return { jsonrpc: '2.0', id: rpcId, status: 'SCHEMA_INVALID', httpCode: 404, error: errorPayload, wireFrame: wf };
  }

  // Step 1: Strict JSON Schema validation at the boundary
  const schemaCheck = validateMCPToolSchema(tool, params.args);
  if (!schemaCheck.valid) {
    const errorPayload = {
      code: -32602,
      message: `MCP Boundary JSON Schema Violation on '${tool.name}'`,
      data: {
        serverId: tool.serverId,
        violations: schemaCheck.errors,
        enforcedSchema: tool.inputSchema
      }
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: tool.serverId,
      toolName: tool.name,
      callerRole: params.callerRole,
      isMutation: tool.isMutation,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'SCHEMA_INVALID',
      latencyMs: Date.now() - start + 2,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return { jsonrpc: '2.0', id: rpcId, status: 'SCHEMA_INVALID', httpCode: 400, error: errorPayload, wireFrame: wf };
  }

  // Step 2: Granular RBAC check at the tool boundary
  if (!tool.allowedRoles.includes(params.callerRole)) {
    const errorPayload = {
      code: -32003,
      message: `RBAC_POLICY_DENIED: Caller role '${params.callerRole}' is not authorized to invoke ${tool.isMutation ? 'mutating' : 'restricted'} tool '${tool.name}' on server '${tool.serverId}'.`,
      data: {
        callerRole: params.callerRole,
        requiredRoles: tool.allowedRoles,
        isMutation: tool.isMutation
      }
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: tool.serverId,
      toolName: tool.name,
      callerRole: params.callerRole,
      isMutation: tool.isMutation,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'RBAC_DENIED',
      latencyMs: Date.now() - start + 1,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return { jsonrpc: '2.0', id: rpcId, status: 'RBAC_DENIED', httpCode: 403, error: errorPayload, wireFrame: wf };
  }

  // Step 3: Additional SQL Read-Only AST/Keyword Guard for sql_execute_readonly_query
  if (tool.name === 'sql_execute_readonly_query' || tool.name === 'sql_explain_query_plan') {
    const rawSql = String(params.args.query || '').trim();
    const forbiddenPattern = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|REPLACE)\b/i;
    if (forbiddenPattern.test(rawSql) || !/^SELECT\b/i.test(rawSql)) {
      const errorPayload = {
        code: -32004,
        message: `SQL_MUTATION_BLOCKED: Server 'sql-ops-mcp' enforces strict read-only SELECT execution. Blocked forbidden DDL/DML statement at tool boundary.`,
        data: { rejectedQuery: rawSql }
      };
      const wf: MCPWireFrame = {
        frameId: rpcId,
        timestamp: new Date().toISOString(),
        serverId: tool.serverId,
        toolName: tool.name,
        callerRole: params.callerRole,
        isMutation: false,
        approvalTokenProvided: Boolean(params.approvalToken),
        status: 'SQL_MUTATION_BLOCKED',
        latencyMs: Date.now() - start + 2,
        requestPayload: params.args,
        responsePayload: errorPayload
      };
      recordWireFrame(wf);
      return {
        jsonrpc: '2.0',
        id: rpcId,
        status: 'SQL_MUTATION_BLOCKED',
        httpCode: 403,
        error: errorPayload,
        wireFrame: wf
      };
    }
  }

  // Step 4: Deterministic Execution across the 28 tools
  let output: any = {};

  switch (tool.name) {
    // --- sql-ops-mcp ---
    case 'sql_execute_readonly_query': {
      const q = String(params.args.query).toLowerCase();
      const limit = Number(params.args.row_limit || 25);
      let matchedTable = Object.values(SQL_TABLES).find((t) => q.includes(t.tableName));
      if (!matchedTable) {
        matchedTable = SQL_TABLES.deployments;
      }
      let rows = [...matchedTable.rows];
      if (q.includes('checkout-ledger-svc')) {
        rows = rows.filter((r) => !r.service || r.service === 'checkout-ledger-svc');
      } else if (q.includes('webhook-dispatcher-v2')) {
        rows = rows.filter((r) => !r.service || r.service === 'webhook-dispatcher-v2');
      }
      output = {
        table: matchedTable.tableName,
        rowCount: rows.slice(0, limit).length,
        rows: rows.slice(0, limit),
        replicaNode: 'pg-ledger-ro-02.us-east-1',
        readOnlyVerified: true
      };
      break;
    }
    case 'sql_inspect_table_schema': {
      const tbl = SQL_TABLES[params.args.table_name];
      output = tbl
        ? { tableName: tbl.tableName, description: tbl.description, columns: tbl.columns }
        : { error: 'Table not found' };
      break;
    }
    case 'sql_explain_query_plan': {
      const q = String(params.args.query);
      const hasForUpdate = /FOR\s+UPDATE/i.test(q);
      output = {
        Plan: {
          Node_Type: hasForUpdate ? 'LockRows (Exclusive Row Lock)' : 'Index Scan',
          Strategy: hasForUpdate ? 'Seq Scan without SKIP LOCKED — HIGH CONTENTION RISK' : 'B-Tree Index Cond',
          Estimated_Cost: hasForUpdate ? 18420.5 : 14.2,
          Advisory_Warning: hasForUpdate
            ? 'Unbounded FOR UPDATE detected; causes PgBouncer pool saturation under canary traffic.'
            : 'Query plan is optimal for read replica execution.'
        }
      };
      break;
    }
    case 'sql_sample_recent_rows': {
      const tbl = SQL_TABLES[params.args.table_name] || SQL_TABLES.deployments;
      const lim = Number(params.args.limit || 10);
      output = {
        tableName: tbl.tableName,
        sampleSize: Math.min(lim, tbl.rows.length),
        rows: tbl.rows.slice(0, lim)
      };
      break;
    }
    case 'sql_check_replication_lag': {
      const rows = SQL_TABLES.db_replication_status.rows.filter((r) =>
        r.cluster.toLowerCase().includes(String(params.args.cluster_name).toLowerCase())
      );
      output = {
        cluster: params.args.cluster_name,
        nodes: rows.length > 0 ? rows : SQL_TABLES.db_replication_status.rows
      };
      break;
    }

    // --- github-mcp ---
    case 'github_get_pr_diff': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(params.args.pr_number)) || GITHUB_PRS[0];
      output = {
        pr_number: pr.pr_number,
        repo: pr.repo,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        changed_files: pr.changed_files,
        diff_summary: pr.diff_summary
      };
      break;
    }
    case 'github_list_pr_checks': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(params.args.pr_number)) || GITHUB_PRS[0];
      output = {
        pr_number: pr.pr_number,
        ci_status: pr.ci_status,
        checks: pr.checks
      };
      break;
    }
    case 'github_blame_file_range': {
      const fp = String(params.args.file_path);
      const isWebhook = fp.toLowerCase().includes('webhook');
      output = {
        file_path: fp,
        last_modified_sha: isWebhook ? 'c4190ab' : 'a8f31c9',
        author: isWebhook ? 'arivera' : 'mchen',
        pr_number: isWebhook ? 1835 : 1842,
        annotation: isWebhook
          ? 'Lines 21-25: Reduced tlsHandshakeTimeoutMs from 2500ms to 400ms'
          : 'Lines 84-89: Replaced bounded SELECT with unbounded SELECT ... FOR UPDATE'
      };
      break;
    }
    case 'github_search_commits': {
      const q = String(params.args.query).toLowerCase();
      const matches = GITHUB_PRS.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.repo.toLowerCase().includes(q) ||
          p.diff_summary.toLowerCase().includes(q)
      );
      output = {
        query: params.args.query,
        commits: (matches.length ? matches : GITHUB_PRS).map((p) => ({
          pr_number: p.pr_number,
          repo: p.repo,
          title: p.title,
          author: p.author
        }))
      };
      break;
    }
    case 'github_post_pr_review_comment': {
      const pr = GITHUB_PRS.find((p) => p.pr_number === Number(params.args.pr_number)) || GITHUB_PRS[0];
      const newComment = {
        id: `gh-c-${Date.now().toString().slice(-4)}`,
        author: `monopulse-agent (${params.callerRole})`,
        body: String(params.args.comment_body),
        created_at: new Date().toISOString()
      };
      pr.comments.push(newComment);
      output = {
        mutated: true,
        pr_number: pr.pr_number,
        comment: newComment
      };
      break;
    }

    // --- slack-mcp ---
    case 'slack_fetch_thread_messages': {
      const thread =
        SLACK_THREADS.find((t) => t.thread_ts === params.args.thread_ts) || SLACK_THREADS[0];
      output = {
        thread_ts: thread.thread_ts,
        channel_name: thread.channel_name,
        topic: thread.topic,
        messages: thread.messages,
        approval_blocks: thread.approval_blocks
      };
      break;
    }
    case 'slack_summarize_incident_thread': {
      const thread =
        SLACK_THREADS.find((t) => t.thread_ts === params.args.thread_ts) || SLACK_THREADS[0];
      output = {
        thread_ts: thread.thread_ts,
        channel: thread.channel_name,
        extracted_signals: {
          mentioned_prs: thread.thread_ts.includes('4200') ? [1842] : [1835],
          mentioned_commits: thread.thread_ts.includes('4200') ? ['a8f31c9'] : ['c4190ab'],
          linked_jira: thread.thread_ts.includes('4200') ? 'OPS-4821' : 'OPS-4819',
          affected_tenants: thread.thread_ts.includes('4200')
            ? ['Acme Global Logistics', 'Kestrel Financial Systems']
            : ['Vanguard BioLabs']
        }
      };
      break;
    }
    case 'slack_search_channel_history': {
      const kw = String(params.args.keyword).toLowerCase();
      const hits = SLACK_THREADS.flatMap((t) =>
        t.messages
          .filter((m) => m.text.toLowerCase().includes(kw))
          .map((m) => ({ channel: t.channel_name, thread_ts: t.thread_ts, user: m.user, text: m.text }))
      );
      output = { keyword: params.args.keyword, matches: hits };
      break;
    }
    case 'slack_post_approval_block': {
      const thread =
        SLACK_THREADS.find((t) => t.thread_ts === params.args.thread_ts) || SLACK_THREADS[0];
      const block = {
        block_id: `blk-${Date.now().toString().slice(-5)}`,
        event_id: String(params.args.event_id),
        summary: String(params.args.summary_markdown),
        status: 'STAGED' as const,
        posted_at: new Date().toISOString()
      };
      thread.approval_blocks.unshift(block);
      output = {
        posted: true,
        channel: thread.channel_name,
        thread_ts: thread.thread_ts,
        block
      };
      break;
    }
    case 'slack_broadcast_resolution': {
      const thread =
        SLACK_THREADS.find((t) => t.channel_name === params.args.channel_name) || SLACK_THREADS[0];
      const msg = {
        user: `monopulse-agent [approved-by:${params.callerRole}]`,
        role: params.callerRole,
        ts: `${Math.floor(Date.now() / 1000)}.009900`,
        text: `[RESOLVED] ${params.args.resolution_message}`
      };
      thread.messages.push(msg);
      output = {
        mutated: true,
        channel: thread.channel_name,
        message: msg
      };
      break;
    }

    // --- jira-mcp ---
    case 'jira_get_ticket_context': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(params.args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      output = { ...ticket };
      break;
    }
    case 'jira_search_similar_issues': {
      const svc = String(params.args.service).toLowerCase();
      const list = JIRA_TICKETS.filter((j) => j.service.toLowerCase().includes(svc));
      output = {
        service: params.args.service,
        tickets: list.length ? list : JIRA_TICKETS
      };
      break;
    }
    case 'jira_transition_ticket_status': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(params.args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      const previousStatus = ticket.status;
      ticket.status = params.args.new_status as JiraTicket['status'];
      output = {
        mutated: true,
        ticket_key: ticket.key,
        previous_status: previousStatus,
        new_status: ticket.status,
        transitioned_by: params.callerRole
      };
      break;
    }
    case 'jira_assign_oncall_owner': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(params.args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      const prev = ticket.assignee;
      ticket.assignee = String(params.args.assignee);
      output = {
        mutated: true,
        ticket_key: ticket.key,
        previous_assignee: prev,
        new_assignee: ticket.assignee
      };
      break;
    }
    case 'jira_append_root_cause_field': {
      const ticket =
        JIRA_TICKETS.find((j) => j.key.toUpperCase() === String(params.args.ticket_key).toUpperCase()) ||
        JIRA_TICKETS[0];
      ticket.root_cause_notes = String(params.args.root_cause_notes);
      output = {
        mutated: true,
        ticket_key: ticket.key,
        root_cause_notes: ticket.root_cause_notes
      };
      break;
    }

    // --- docs-mcp ---
    case 'docs_semantic_search': {
      const q = String(params.args.query).toLowerCase();
      const docs = INTERNAL_DOCS.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.markdown_body.toLowerCase().includes(q) ||
          d.service.toLowerCase().includes(q)
      );
      output = {
        query: params.args.query,
        results: (docs.length ? docs : INTERNAL_DOCS).map((d) => ({
          doc_id: d.doc_id,
          title: d.title,
          service: d.service,
          category: d.category,
          excerpt: d.markdown_body.slice(0, 260)
        }))
      };
      break;
    }
    case 'docs_get_runbook_by_service': {
      const doc =
        INTERNAL_DOCS.find(
          (d) => d.service.toLowerCase() === String(params.args.service).toLowerCase() && d.category === 'Runbook'
        ) || INTERNAL_DOCS[0];
      output = { ...doc };
      break;
    }
    case 'docs_list_postmortems': {
      const pms = INTERNAL_DOCS.filter((d) => d.category === 'Postmortem');
      output = { postmortems: pms };
      break;
    }
    case 'docs_propose_runbook_patch': {
      const doc =
        INTERNAL_DOCS.find((d) => d.doc_id.toUpperCase() === String(params.args.doc_id).toUpperCase()) ||
        INTERNAL_DOCS[0];
      const patch = {
        id: `patch-${Date.now().toString().slice(-4)}`,
        author: `monopulse-agent (${params.callerRole})`,
        diff: String(params.args.patch_markdown),
        status: 'MERGED_INTO_RUNBOOK',
        timestamp: new Date().toISOString()
      };
      doc.proposed_patches.push(patch);
      doc.markdown_body += `\n\n### Automated Guardrail Patch (${patch.id})\n${params.args.patch_markdown}`;
      output = {
        mutated: true,
        doc_id: doc.doc_id,
        patch
      };
      break;
    }

    // --- infra-mcp ---
    case 'infra_get_service_error_rate': {
      const svc = POD_TELEMETRY[params.args.service] || POD_TELEMETRY['checkout-ledger-svc'];
      output = {
        service: svc.service,
        error_rate_pct: svc.error_rate_pct,
        p99_latency_ms: svc.p99_latency_ms,
        active_canary_id: svc.active_canary_id
      };
      break;
    }
    case 'infra_fetch_pod_logs': {
      const svc = POD_TELEMETRY[params.args.service] || POD_TELEMETRY['checkout-ledger-svc'];
      output = {
        service: svc.service,
        recent_logs: svc.recent_logs
      };
      break;
    }
    case 'infra_check_feature_flags': {
      const flags = SQL_TABLES.feature_flags.rows.filter(
        (f) => f.service.toLowerCase() === String(params.args.service).toLowerCase()
      );
      output = {
        service: params.args.service,
        flags: flags.length ? flags : SQL_TABLES.feature_flags.rows
      };
      break;
    }
    case 'infra_trigger_canary_rollback': {
      const depRow = SQL_TABLES.deployments.rows.find((r) => r.deploy_id === params.args.deploy_id);
      if (depRow) {
        depRow.status = 'ROLLED_BACK';
        depRow.canary_weight_pct = 0;
      }
      const ledgerTelemetry = POD_TELEMETRY['checkout-ledger-svc'];
      ledgerTelemetry.error_rate_pct = 0.18;
      ledgerTelemetry.p99_latency_ms = 94;
      ledgerTelemetry.active_canary_id = null;
      ledgerTelemetry.recent_logs.unshift(
        `${new Date().toISOString()} [INFO] [canary-controller] Rolled back ${params.args.deploy_id} (${params.args.reason}). Error rate recovered to 0.18%.`
      );
      output = {
        mutated: true,
        deploy_id: params.args.deploy_id,
        new_status: 'ROLLED_BACK',
        traffic_shifted_to_stable_pct: 100,
        post_rollback_error_rate_pct: 0.18,
        post_rollback_p99_ms: 94
      };
      break;
    }
  }

  const wf: MCPWireFrame = {
    frameId: rpcId,
    timestamp: new Date().toISOString(),
    serverId: tool.serverId,
    toolName: tool.name,
    callerRole: params.callerRole,
    isMutation: tool.isMutation,
    approvalTokenProvided: Boolean(params.approvalToken),
    status: 'SUCCESS',
    latencyMs: Math.max(4, Date.now() - start + Math.floor(Math.random() * 9) + 3),
    requestPayload: params.args,
    responsePayload: output
  };
  recordWireFrame(wf);

  return {
    jsonrpc: '2.0',
    id: rpcId,
    status: 'SUCCESS',
    httpCode: 200,
    result: output,
    wireFrame: wf
  };
}
