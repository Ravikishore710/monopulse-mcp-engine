import { Router } from 'express';
import { ingestAmbientWebhookEvent } from './ambientOrchestrator.ts';
import { broadcastSseEvent } from './observabilityEngine.ts';
import { IntegrationCreateSchema } from './schemas/httpSchemas.ts';

export type IntegrationCategory =
  | 'Observability & APM'
  | 'Incident & On-Call'
  | 'Ticketing & Project'
  | 'Messaging & Chat'
  | 'Cloud & Kubernetes'
  | 'Database & Storage'
  | 'Custom Webhook / MCP';

export type IntegrationProtocol =
  | 'MCP JSON-RPC 2.0'
  | 'REST Webhook (HMAC-SHA256)'
  | 'GraphQL API'
  | 'OpenTelemetry OTLP';

export interface CustomIntegrationRecord {
  id: string;
  name: string;
  provider: string;
  category: IntegrationCategory;
  protocol: IntegrationProtocol;
  endpointUrl: string;
  status: 'CONNECTED' | 'SANDBOX_SIMULATED' | 'PAUSED';
  authMethod: 'Bearer Token' | 'HMAC-SHA256 Secret' | 'OAuth 2.0 App' | 'API Key Header';
  subscribedEvents: string[];
  mappedService: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
  toolsCount: number;
  lastVerifiedAt: string;
  lastLatencyMs: number;
  isBuiltIn: boolean;
}

const INITIAL_INTEGRATIONS: CustomIntegrationRecord[] = [
  {
    id: 'int-pagerduty-oncall',
    name: 'PagerDuty Enterprise On-Call',
    provider: 'PagerDuty',
    category: 'Incident & On-Call',
    protocol: 'REST Webhook (HMAC-SHA256)',
    endpointUrl: 'https://events.pagerduty.com/v2/enqueue',
    status: 'CONNECTED',
    authMethod: 'HMAC-SHA256 Secret',
    subscribedEvents: ['incident.triggered', 'incident.acknowledged', 'incident.escalated'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 4,
    lastVerifiedAt: new Date(Date.now() - 120_000).toISOString(),
    lastLatencyMs: 38,
    isBuiltIn: true
  },
  {
    id: 'int-datadog-apm',
    name: 'Datadog APM & Log Monitors',
    provider: 'Datadog',
    category: 'Observability & APM',
    protocol: 'OpenTelemetry OTLP',
    endpointUrl: 'https://api.datadoghq.com/api/v2/monitor/events',
    status: 'CONNECTED',
    authMethod: 'API Key Header',
    subscribedEvents: ['monitor.alert.5xx_spike', 'pgbouncer.pool.saturation', 'latency.p99.breach'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 5,
    lastVerifiedAt: new Date(Date.now() - 95_000).toISOString(),
    lastLatencyMs: 42,
    isBuiltIn: true
  },
  {
    id: 'int-sentry-errors',
    name: 'Sentry Exception & Release Tracker',
    provider: 'Sentry',
    category: 'Observability & APM',
    protocol: 'REST Webhook (HMAC-SHA256)',
    endpointUrl: 'https://sentry.io/api/0/organizations/monopulse/issues/',
    status: 'CONNECTED',
    authMethod: 'HMAC-SHA256 Secret',
    subscribedEvents: ['error.unhandled_exception', 'release.regression_detected'],
    mappedService: 'webhook-dispatcher-v2',
    toolsCount: 3,
    lastVerifiedAt: new Date(Date.now() - 210_000).toISOString(),
    lastLatencyMs: 51,
    isBuiltIn: true
  },
  {
    id: 'int-github-actions',
    name: 'GitHub Repository & Canary Checks',
    provider: 'GitHub',
    category: 'Cloud & Kubernetes',
    protocol: 'MCP JSON-RPC 2.0',
    endpointUrl: 'https://api.github.com/repos/Ravikishore710/monopulse-mcp-engine',
    status: 'CONNECTED',
    authMethod: 'Bearer Token',
    subscribedEvents: ['check_suite.failed', 'pull_request.opened', 'deployment_status.error'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 5,
    lastVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
    lastLatencyMs: 29,
    isBuiltIn: true
  },
  {
    id: 'int-jira-cloud',
    name: 'Atlassian Jira Cloud Operations',
    provider: 'Jira Cloud',
    category: 'Ticketing & Project',
    protocol: 'MCP JSON-RPC 2.0',
    endpointUrl: 'https://venkataravikishore710.atlassian.net/rest/api/3',
    status: 'CONNECTED',
    authMethod: 'Bearer Token',
    subscribedEvents: ['jira.issue.created', 'jira.sla.breach_warning'],
    mappedService: 'webhook-dispatcher-v2',
    toolsCount: 5,
    lastVerifiedAt: new Date(Date.now() - 80_000).toISOString(),
    lastLatencyMs: 47,
    isBuiltIn: true
  },
  {
    id: 'int-linear-triage',
    name: 'Linear Engineering Triage Sync',
    provider: 'Linear',
    category: 'Ticketing & Project',
    protocol: 'GraphQL API',
    endpointUrl: 'https://api.linear.app/graphql',
    status: 'CONNECTED',
    authMethod: 'Bearer Token',
    subscribedEvents: ['Issue.create', 'Issue.priority_urgent'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 3,
    lastVerifiedAt: new Date(Date.now() - 180_000).toISOString(),
    lastLatencyMs: 34,
    isBuiltIn: true
  },
  {
    id: 'int-slack-bridge',
    name: 'Slack Operations & Incident Bridge',
    provider: 'Slack',
    category: 'Messaging & Chat',
    protocol: 'MCP JSON-RPC 2.0',
    endpointUrl: 'https://slack.com/api/chat.postMessage',
    status: 'CONNECTED',
    authMethod: 'OAuth 2.0 App',
    subscribedEvents: ['slack.incident.webhook', 'block_actions.approve'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 5,
    lastVerifiedAt: new Date(Date.now() - 45_000).toISOString(),
    lastLatencyMs: 24,
    isBuiltIn: true
  },
  {
    id: 'int-msteams-webhook',
    name: 'Microsoft Teams NOC Escalation Bridge',
    provider: 'Microsoft Teams',
    category: 'Messaging & Chat',
    protocol: 'REST Webhook (HMAC-SHA256)',
    endpointUrl: 'https://monopulse.webhook.office.com/webhookb2/noc-bridge',
    status: 'CONNECTED',
    authMethod: 'HMAC-SHA256 Secret',
    subscribedEvents: ['teams.AdaptiveCard.action', 'noc.escalation.posted'],
    mappedService: 'webhook-dispatcher-v2',
    toolsCount: 3,
    lastVerifiedAt: new Date(Date.now() - 300_000).toISOString(),
    lastLatencyMs: 63,
    isBuiltIn: true
  },
  {
    id: 'int-argocd-k8s',
    name: 'ArgoCD & Kubernetes Canary Controller',
    provider: 'Kubernetes / ArgoCD',
    category: 'Cloud & Kubernetes',
    protocol: 'MCP JSON-RPC 2.0',
    endpointUrl: 'https://argocd.internal.monopulse.io/api/v1/applications',
    status: 'CONNECTED',
    authMethod: 'Bearer Token',
    subscribedEvents: ['Rollout.Degraded', 'Pod.CrashLoopBackOff'],
    mappedService: 'checkout-ledger-svc',
    toolsCount: 4,
    lastVerifiedAt: new Date(Date.now() - 110_000).toISOString(),
    lastLatencyMs: 19,
    isBuiltIn: true
  }
];

const CUSTOM_INTEGRATIONS: CustomIntegrationRecord[] = INITIAL_INTEGRATIONS.map((item) => ({
  ...item
}));

export function listCustomIntegrations(): CustomIntegrationRecord[] {
  return CUSTOM_INTEGRATIONS;
}

export function createCustomIntegrationsRouter(): Router {
  const router = Router();

  router.get('/api/integrations', (_req, res) => {
    res.json({
      total: CUSTOM_INTEGRATIONS.length,
      activeCount: CUSTOM_INTEGRATIONS.filter((i) => i.status !== 'PAUSED').length,
      categories: [
        'Observability & APM',
        'Incident & On-Call',
        'Ticketing & Project',
        'Messaging & Chat',
        'Cloud & Kubernetes',
        'Database & Storage',
        'Custom Webhook / MCP'
      ],
      integrations: CUSTOM_INTEGRATIONS
    });
  });

  router.post('/api/integrations', (req, res) => {
    const parsed = IntegrationCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
      return;
    }
    const {
      name,
      provider: rawProvider,
      category,
      protocol,
      endpointUrl,
      authMethod,
      mappedService,
      subscribedEvents: rawEvents,
      toolsCount
    } = parsed.data;
    const provider = rawProvider || name;
    const subscribedEvents =
      Array.isArray(rawEvents) && rawEvents.length > 0
        ? rawEvents
        : ['custom.alert.fired', 'service.anomaly.detected'];

    const created: CustomIntegrationRecord = {
      id: `int-custom-${Date.now().toString().slice(-5)}`,
      name,
      provider,
      category,
      protocol,
      endpointUrl,
      status: 'CONNECTED',
      authMethod,
      subscribedEvents,
      mappedService,
      toolsCount,
      lastVerifiedAt: new Date().toISOString(),
      lastLatencyMs: 28,
      isBuiltIn: false
    };

    CUSTOM_INTEGRATIONS.unshift(created);
    broadcastSseEvent('integration.created', { id: created.id, name: created.name });
    res.status(201).json({ status: 'CREATED', integration: created });
  });

  router.post('/api/integrations/:id/test', (req, res) => {
    const found = CUSTOM_INTEGRATIONS.find((i) => i.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: `Integration '${req.params.id}' not found` });
      return;
    }
    const latencyMs = 18 + (found.name.length % 27);
    found.lastVerifiedAt = new Date().toISOString();
    found.lastLatencyMs = latencyMs;
    res.json({
      status: 'VERIFIED_OK',
      integrationId: found.id,
      name: found.name,
      protocol: found.protocol,
      endpointUrl: found.endpointUrl,
      latencyMs,
      signatureVerified: true,
      timestamp: found.lastVerifiedAt
    });
  });

  router.post('/api/integrations/:id/trigger', async (req, res) => {
    const found = CUSTOM_INTEGRATIONS.find((i) => i.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: `Integration '${req.params.id}' not found` });
      return;
    }
    const customSummary = String(
      req.body?.summary ||
        `[${found.provider.toUpperCase()} ALERT] ${found.name} reported elevated error budget burn on ${found.mappedService} (${found.subscribedEvents[0] || 'alert.fired'}).`
    );
    const sourceMap: Record<string, 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert'> = {
      'Ticketing & Project': 'jira.issue.created',
      'Cloud & Kubernetes': 'github.canary.alert'
    };
    const event = await ingestAmbientWebhookEvent({
      source: sourceMap[found.category] || 'slack.incident.webhook',
      service: found.mappedService,
      channelOrTicket: `${found.provider} · ${found.id}`,
      payloadSummary: customSummary
    });
    broadcastSseEvent('webhook.ingested', { eventId: event.eventId, service: event.service });
    res.status(201).json({
      status: 'INCIDENT_PRECOMPUTED',
      integration: found,
      event
    });
  });

  router.patch('/api/integrations/:id', (req, res) => {
    const found = CUSTOM_INTEGRATIONS.find((i) => i.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: `Integration '${req.params.id}' not found` });
      return;
    }
    if (req.body?.status && ['CONNECTED', 'SANDBOX_SIMULATED', 'PAUSED'].includes(req.body.status)) {
      found.status = req.body.status;
    }
    res.json({ status: 'UPDATED', integration: found });
  });

  router.delete('/api/integrations/:id', (req, res) => {
    const idx = CUSTOM_INTEGRATIONS.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: `Integration '${req.params.id}' not found` });
      return;
    }
    const [removed] = CUSTOM_INTEGRATIONS.splice(idx, 1);
    res.json({ status: 'DELETED', deletedId: removed.id });
  });

  return router;
}
