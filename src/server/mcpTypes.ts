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
    description:
      'Deterministic read-only SQL introspection with AST/regex DDL & DML mutation blocking at the protocol boundary.',
    toolCount: 5
  },
  {
    id: 'github-mcp',
    name: 'GitHub PR & Commit Inspector',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '1.9.2',
    domain: 'GitHub Enterprise / CI Checks',
    description:
      'Inspects pull request diffs, failing CI check logs, git blame ranges, and posts review annotations.',
    toolCount: 5
  },
  {
    id: 'slack-mcp',
    name: 'Slack Incident Thread & Block Bus',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '3.1.0',
    domain: 'Slack Events API & Block Kit',
    description:
      'Summarizes noisy incident threads, searches historical channel logs, and dispatches 1-Click Approve/Edit blocks.',
    toolCount: 5
  },
  {
    id: 'jira-mcp',
    name: 'Jira Ticket Mutator & SLA Engine',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '2.2.1',
    domain: 'Jira Ops / Incident Tracking',
    description:
      'Reads incident context and SLA timers; gates status transitions, root-cause writes, and on-call reassignments behind RBAC.',
    toolCount: 5
  },
  {
    id: 'docs-mcp',
    name: 'Internal Runbooks & Postmortem Vault',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '1.7.4',
    domain: 'Engineering Knowledge Base',
    description:
      'Retrieves service remediation runbooks, historical postmortems, and stages runbook diff patches.',
    toolCount: 4
  },
  {
    id: 'infra-mcp',
    name: 'Kubernetes & Canary Telemetry Controller',
    transport: 'json-rpc-2.0/stdio-bridge',
    version: '4.0.1',
    domain: 'Service Mesh & Canary Rollouts',
    description:
      'Streams pod error rates, p99 latencies, launch flags, and executes RBAC-gated canary rollbacks.',
    toolCount: 4
  }
];
