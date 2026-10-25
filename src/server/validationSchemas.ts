import { z } from 'zod';

export const RBACRoleSchema = z.enum([
  'sre_admin',
  'eng_lead',
  'support_tier2',
  'readonly_analyst'
]);

export const McpRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional().default('2.0'),
  id: z.string().optional(),
  method: z.enum(['tools/list', 'tools/call']).optional().default('tools/call'),
  params: z
    .object({
      name: z.string().min(1).optional(),
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
  editedMutations: z
    .array(
      z.object({
        id: z.string().min(1),
        args: z.record(z.string(), z.unknown())
      })
    )
    .optional()
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
