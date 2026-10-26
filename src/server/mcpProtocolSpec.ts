import { MCP_SERVERS, MCP_TOOLS, executeMCPToolCall, RBACRole } from './mcpRegistry.ts';
import { INTERNAL_DOCS, SQL_TABLES } from './sandboxData.ts';
import { McpRpcRequestSchema } from './validationSchemas.ts';
import { resolveVerifiedCallerRole } from './cryptoSecurity.ts';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPPromptDefinition {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

let currentMcpLogLevel = 'info';

export const MCP_RESOURCES: MCPResourceDefinition[] = [
  {
    uri: 'monopulse://schema/sqlite-tables',
    name: 'SQLite Operational Database Schema',
    description: 'Normalized relational schema for deployments, service_incidents, customer_orgs, and mcp_audit_log',
    mimeType: 'application/json'
  },
  {
    uri: 'monopulse://runbooks/checkout-ledger-svc',
    name: 'Checkout Ledger Service Canary Runbook',
    description: 'Standard operating procedures for PgBouncer lock exhaustion and canary rollback',
    mimeType: 'text/markdown'
  },
  {
    uri: 'monopulse://telemetry/replication-lag',
    name: 'PostgreSQL / SQLite Replica Telemetry',
    description: 'Real-time WAL replication lag and active lock snapshots',
    mimeType: 'application/json'
  }
];

export const MCP_RESOURCE_TEMPLATES: MCPResourceTemplateDefinition[] = [
  {
    uriTemplate: 'monopulse://tables/{tableName}',
    name: 'Dynamic SQLite Table Snapshot',
    description: 'Read rows and schema metadata for any operational table by name',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'monopulse://runbooks/{service}',
    name: 'Dynamic Microservice Runbook Lookup',
    description: 'Fetch Markdown runbook SOPs for a given service slug',
    mimeType: 'text/markdown'
  }
];

export const MCP_PROMPTS: MCPPromptDefinition[] = [
  {
    name: 'incident-rca-synthesis',
    description: 'Synthesizes a 2-sentence root-cause analysis from read-only MCP diagnostic traces',
    arguments: [
      { name: 'service', description: 'Affected microservice name', required: true },
      { name: 'payloadSummary', description: 'Webhook alert payload summary', required: true }
    ]
  },
  {
    name: 'canary-rollback-safety-check',
    description: 'Generates pre-execution safety checks for a 1-Click Canary Rollback approval block',
    arguments: [
      { name: 'deploy_id', description: 'Target canary deployment ID', required: true },
      { name: 'error_rate_pct', description: 'Observed 5xx error percentage', required: false }
    ]
  }
];

export function handleMcpPing(id: string | number = 'ping-1') {
  return { jsonrpc: '2.0' as const, id, result: { ok: true } };
}

export function handleMcpLoggingSetLevel(level: string, id: string | number = 'log-1') {
  const validLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
  currentMcpLogLevel = validLevels.includes(level) ? level : 'info';
  return { jsonrpc: '2.0' as const, id, result: { level: currentMcpLogLevel } };
}

export function handleMcpCompletionComplete(argumentValue: string, id: string | number = 'comp-1') {
  const prefix = (argumentValue || '').toLowerCase();
  const candidates = [
    ...MCP_RESOURCES.map((r) => r.uri),
    'monopulse://tables/deployments',
    'monopulse://tables/service_incidents',
    'monopulse://tables/customer_orgs',
    'monopulse://tables/feature_flags',
    'checkout-ledger-svc',
    'webhook-dispatcher-v2',
    'auth-token-gateway'
  ].filter((c) => c.toLowerCase().includes(prefix));

  return {
    jsonrpc: '2.0' as const,
    id,
    result: {
      completion: {
        values: candidates.slice(0, 10),
        total: candidates.length,
        hasMore: candidates.length > 10
      }
    }
  };
}

export function handleMcpInitialize(id: string | number = 'init-1') {
  return {
    jsonrpc: '2.0' as const,
    id,
    result: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: 'monopulse-mcp-control-plane',
        version: '1.3.0',
        mountedServers: MCP_SERVERS.length,
        registeredTools: MCP_TOOLS.length
      },
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
        logging: {}
      }
    }
  };
}

export function getToolsListWithAnnotations() {
  return MCP_TOOLS.map((tool) => ({
    ...tool,
    annotations: {
      title: tool.name,
      readOnlyHint: !tool.isMutation,
      destructiveHint: tool.isMutation,
      idempotentHint: !tool.isMutation,
      openWorldHint: false
    }
  }));
}

export function handleMcpResourcesList(id: string | number = 'res-list') {
  return { jsonrpc: '2.0' as const, id, result: { resources: MCP_RESOURCES } };
}

export function handleMcpResourceTemplatesList(id: string | number = 'res-tpl-list') {
  return { jsonrpc: '2.0' as const, id, result: { resourceTemplates: MCP_RESOURCE_TEMPLATES } };
}

export function handleMcpResourcesRead(uri: string, id: string | number = 'res-read') {
  if (uri === 'monopulse://schema/sqlite-tables') {
    return {
      jsonrpc: '2.0' as const,
      id,
      result: {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              Object.values(SQL_TABLES).map((t) => ({
                tableName: t.tableName,
                description: t.description,
                columns: t.columns
              })),
              null,
              2
            )
          }
        ]
      }
    };
  }

  if (uri.startsWith('monopulse://tables/')) {
    const tableName = uri.replace('monopulse://tables/', '').trim();
    const tbl = SQL_TABLES[tableName];
    if (tbl) {
      return {
        jsonrpc: '2.0' as const,
        id,
        result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(tbl, null, 2) }] }
      };
    }
  }

  if (uri.startsWith('monopulse://runbooks/')) {
    const serviceSlug = uri.replace('monopulse://runbooks/', '').trim();
    const doc = INTERNAL_DOCS.find((d) => d.service === serviceSlug) || INTERNAL_DOCS[0];
    return {
      jsonrpc: '2.0' as const,
      id,
      result: { contents: [{ uri, mimeType: 'text/markdown', text: doc.markdown_body }] }
    };
  }

  if (uri === 'monopulse://telemetry/replication-lag') {
    return {
      jsonrpc: '2.0' as const,
      id,
      result: {
        contents: [
          { uri, mimeType: 'application/json', text: JSON.stringify(SQL_TABLES.db_replication_status.rows, null, 2) }
        ]
      }
    };
  }

  return { jsonrpc: '2.0' as const, id, error: { code: -32602, message: `MCP Resource URI '${uri}' not found.` } };
}

export function handleMcpPromptsList(id: string | number = 'prompt-list') {
  return { jsonrpc: '2.0' as const, id, result: { prompts: MCP_PROMPTS } };
}

export function handleMcpPromptsGet(
  name: string,
  args: Record<string, string> = {},
  id: string | number = 'prompt-get'
) {
  const prompt = MCP_PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    return { jsonrpc: '2.0' as const, id, error: { code: -32602, message: `MCP Prompt '${name}' not found.` } };
  }

  const service = args.service || 'checkout-ledger-svc';
  const summary = args.payloadSummary || args.deploy_id || 'dep-9042';
  return {
    jsonrpc: '2.0' as const,
    id,
    result: {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `[MCP Prompt: ${prompt.name}] Service: ${service} | Context: ${summary}. Execute read-only verification before staging any 1-Click mutation.`
          }
        }
      ]
    }
  };
}

export function getOpenApi31Specification(): Record<string, any> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MonoPulse MCP & Ambient AI Control Plane API',
      version: '1.3.0',
      description: 'JSON-RPC 2.0 Model Context Protocol (2024-11-05) Gateway, Durable Event Orchestrator, and Cryptographic Audit Ledger',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' }
    },
    paths: {
      '/api/health': { get: { summary: 'System health and readiness summary' } },
      '/api/health/live': { get: { summary: 'Kubernetes liveness probe' } },
      '/api/health/ready': { get: { summary: 'Kubernetes readiness probe verifying SQLite' } },
      '/api/metrics': { get: { summary: 'Prometheus v0.0.4 metrics & latency histograms' } },
      '/api/mcp/rpc': { post: { summary: 'MCP JSON-RPC 2.0 single & batch endpoint' } },
      '/api/webhooks/ingest': { post: { summary: 'Multi-source HMAC-verified webhook ingestion' } },
      '/api/events/{eventId}/approve': { post: { summary: '1-Click & 2-Person Quorum approval execution' } },
      '/api/security/hash-chain/verify': { get: { summary: 'Verify SHA-256 tamper-evident audit chain' } },
      '/api/security/dlq': { get: { summary: 'Inspect Dead-Letter Queue (DLQ) entries' } },
      '/api/openapi.json': { get: { summary: 'OpenAPI 3.1.0 specification document' } }
    }
  };
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxoxb-[A-Za-z0-9-]{15,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g
];

export function sanitizeAndTruncateMcpPayload<T>(payload: T, maxBytes = 16384): T {
  if (payload === null || payload === undefined) return payload;
  let serialized = JSON.stringify(payload);
  for (const regex of SECRET_PATTERNS) {
    serialized = serialized.replace(regex, '[REDACTED_SECRET]');
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return {
      _truncated: true,
      maxBytesAllowed: maxBytes,
      preview: serialized.slice(0, maxBytes)
    } as unknown as T;
  }
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return payload;
  }
}

export function executeSingleMcpRpcPayload(
  rawBody: unknown,
  authHeader?: string
): { httpCode: number; body: Record<string, any> } {
  const parsed = McpRpcRequestSchema.parse(rawBody);
  const rpcId = parsed.id ?? 'rpc-1';

  if (parsed.method === 'initialize') return { httpCode: 200, body: handleMcpInitialize(rpcId) };
  if (parsed.method === 'ping') return { httpCode: 200, body: handleMcpPing(rpcId) };
  if (parsed.method === 'notifications/initialized' || parsed.method === 'notifications/cancelled') {
    return { httpCode: 200, body: { jsonrpc: '2.0', id: rpcId, result: { ok: true, acknowledged: true } } };
  }
  if (parsed.method === 'logging/setLevel') {
    return { httpCode: 200, body: handleMcpLoggingSetLevel(parsed.params?.level || 'info', rpcId) };
  }
  if (parsed.method === 'completion/complete') {
    return { httpCode: 200, body: handleMcpCompletionComplete(parsed.params?.argument?.value || '', rpcId) };
  }
  if (parsed.method === 'resources/list') return { httpCode: 200, body: handleMcpResourcesList(rpcId) };
  if (parsed.method === 'resources/templates/list') {
    return { httpCode: 200, body: handleMcpResourceTemplatesList(rpcId) };
  }
  if (parsed.method === 'resources/read') {
    const uri = parsed.params?.uri || 'monopulse://schema/sqlite-tables';
    const resRead = handleMcpResourcesRead(uri, rpcId);
    return { httpCode: 'error' in resRead ? 404 : 200, body: resRead };
  }
  if (parsed.method === 'prompts/list') return { httpCode: 200, body: handleMcpPromptsList(rpcId) };
  if (parsed.method === 'prompts/get') {
    const name = parsed.params?.name || 'incident-rca-synthesis';
    const promptRes = handleMcpPromptsGet(name, (parsed.params?.arguments || {}) as Record<string, string>, rpcId);
    return { httpCode: 'error' in promptRes ? 404 : 200, body: promptRes };
  }
  if (parsed.method === 'tools/list') {
    return {
      httpCode: 200,
      body: { jsonrpc: '2.0', id: rpcId, result: { servers: MCP_SERVERS, tools: getToolsListWithAnnotations() } }
    };
  }

  const toolName = parsed.params?.name || parsed.toolName || '';
  const args = (parsed.params?.arguments || parsed.args || {}) as Record<string, any>;
  const declaredRole: RBACRole = parsed.params?.callerRole || parsed.callerRole || 'readonly_analyst';
  const roleResolution = resolveVerifiedCallerRole(authHeader, declaredRole);
  const approvalToken = parsed.params?.approvalToken || parsed.approvalToken;
  const outcome = executeMCPToolCall({
    toolName,
    args,
    callerRole: roleResolution.role,
    approvalToken
  });
  return { httpCode: outcome.httpCode, body: outcome };
}
