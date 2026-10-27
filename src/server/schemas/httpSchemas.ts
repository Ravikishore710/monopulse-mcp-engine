import { z } from 'zod';

export const RBACRoleSchema = z.enum([
  'sre_admin',
  'eng_lead',
  'support_tier2',
  'readonly_analyst'
]);

export const McpRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional().default('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z
    .enum([
      'initialize',
      'notifications/initialized',
      'notifications/cancelled',
      'ping',
      'logging/setLevel',
      'completion/complete',
      'tools/list',
      'tools/call',
      'resources/list',
      'resources/templates/list',
      'resources/read',
      'prompts/list',
      'prompts/get'
    ])
    .optional()
    .default('tools/call'),
  params: z
    .object({
      name: z.string().min(1).optional(),
      uri: z.string().min(1).optional(),
      level: z.string().min(1).optional(),
      argument: z
        .object({
          name: z.string().optional(),
          value: z.string().optional()
        })
        .optional(),
      arguments: z.record(z.string(), z.unknown()).optional(),
      callerRole: RBACRoleSchema.optional(),
      approvalToken: z.string().optional()
    })
    .optional(),
  toolName: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  callerRole: RBACRoleSchema.optional(),
  approvalToken: z.string().optional()
});

export const WebhookIngestSchema = z.object({
  source: z.enum([
    'slack.incident.webhook',
    'jira.issue.created',
    'github.canary.alert'
  ]),
  service: z.enum([
    'checkout-ledger-svc',
    'webhook-dispatcher-v2',
    'auth-token-gateway'
  ]),
  channelOrTicket: z.string().min(2).max(160),
  payloadSummary: z.string().min(5).max(1200)
});

export const EventApprovalSchema = z.object({
  callerRole: RBACRoleSchema.optional().default('sre_admin'),
  operatorId: z.string().min(1).max(80).optional(),
  requireQuorum: z.boolean().optional(),
  editedMutations: z
    .array(
      z.object({
        id: z.string().min(1),
        args: z.record(z.string(), z.unknown())
      })
    )
    .optional()
});

export const PlaybookFeedbackSchema = z.object({
  vote: z.enum(['upvote', 'downvote']),
  editedMarkdown: z.string().min(10).max(8000).optional()
});

export const MemorySearchSchema = z.object({
  query: z.string().min(2).max(600),
  topK: z.number().int().min(1).max(10).optional().default(3)
});

export const KaggleDistillSchema = z.object({
  eventId: z.string().min(1).optional(),
  customService: z.string().min(1).max(100).optional(),
  customIncidentSummary: z.string().min(4).max(1200).optional()
});

export const CliExecSchema = z.object({
  command: z.string().min(1).max(600),
  callerRole: RBACRoleSchema.optional().default('sre_admin')
});

export const IntegrationCreateSchema = z.object({
  name: z.string().trim().min(2, 'Integration name must be at least 2 characters').max(120),
  provider: z.string().trim().min(2).max(80).optional(),
  category: z
    .enum([
      'Observability & APM',
      'Incident & On-Call',
      'Ticketing & Project',
      'Messaging & Chat',
      'Cloud & Kubernetes',
      'Database & Storage',
      'Custom Webhook / MCP'
    ])
    .optional()
    .default('Custom Webhook / MCP'),
  protocol: z
    .enum([
      'MCP JSON-RPC 2.0',
      'REST Webhook (HMAC-SHA256)',
      'GraphQL API',
      'OpenTelemetry OTLP'
    ])
    .optional()
    .default('REST Webhook (HMAC-SHA256)'),
  endpointUrl: z.string().url().optional().default('https://api.example.com/webhooks/monopulse'),
  authMethod: z
    .enum(['HMAC-SHA256 Secret', 'Bearer Token', 'OAuth 2.0 App', 'API Key Header'])
    .optional()
    .default('HMAC-SHA256 Secret'),
  mappedService: z
    .enum(['checkout-ledger-svc', 'webhook-dispatcher-v2'])
    .optional()
    .default('checkout-ledger-svc'),
  subscribedEvents: z.array(z.string().min(1)).optional(),
  toolsCount: z.number().int().min(1).max(50).optional().default(2)
});

export const IntegrationUpdateSchema = z.object({
  status: z.enum(['CONNECTED', 'SANDBOX_SIMULATED', 'PAUSED'])
});

export const SlackMessageCreateSchema = z.object({
  channelId: z.string().min(2).max(60).optional().default('C04INCIDENTS'),
  userHandle: z.string().min(2).max(60).optional().default('ravi.kishore'),
  text: z.string().trim().min(1, 'Slack message text cannot be empty').max(2000),
  triggerAmbientPrecompute: z.boolean().optional().default(false),
  service: z
    .enum(['checkout-ledger-svc', 'webhook-dispatcher-v2'])
    .optional()
    .default('checkout-ledger-svc')
});
