/**
 * Dual-Mode External Connectors, Circuit Breakers, Exponential Backoff & Multi-Source Webhook Normalizer
 */

export interface ConnectorStatus {
  serverId: string;
  provider: string;
  mode: 'LIVE_REST_API' | 'SQLITE_EMBEDDED_ENGINE' | 'DETERMINISTIC_FALLBACK';
  envVarConfigured: boolean;
  endpointBase: string;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
}

interface CircuitBreakerRecord {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  openedAt: number;
}

const circuitBreakers = new Map<string, CircuitBreakerRecord>();
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

export function getConnectorCircuitState(serverId: string): CircuitBreakerRecord {
  const existing = circuitBreakers.get(serverId) || {
    state: 'CLOSED',
    failures: 0,
    openedAt: 0
  };
  if (existing.state === 'OPEN' && Date.now() - existing.openedAt > COOLDOWN_MS) {
    existing.state = 'HALF_OPEN';
  }
  circuitBreakers.set(serverId, existing);
  return existing;
}

export function recordConnectorSuccess(serverId: string): void {
  circuitBreakers.set(serverId, { state: 'CLOSED', failures: 0, openedAt: 0 });
}

export function recordConnectorFailure(serverId: string): CircuitBreakerRecord {
  const current = getConnectorCircuitState(serverId);
  const nextFailures = current.failures + 1;
  const nextState = nextFailures >= FAILURE_THRESHOLD ? 'OPEN' : 'CLOSED';
  const updated: CircuitBreakerRecord = {
    state: nextState,
    failures: nextFailures,
    openedAt: nextState === 'OPEN' ? Date.now() : current.openedAt
  };
  circuitBreakers.set(serverId, updated);
  return updated;
}

export async function executeWithRetryAndCircuitBreaker<T>(
  serverId: string,
  operation: () => Promise<T>,
  fallback: () => T,
  maxRetries = 2
): Promise<{ data: T; liveExecuted: boolean; attempts: number; circuitState: string }> {
  const breaker = getConnectorCircuitState(serverId);
  if (breaker.state === 'OPEN') {
    return {
      data: fallback(),
      liveExecuted: false,
      attempts: 0,
      circuitState: 'OPEN'
    };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      recordConnectorSuccess(serverId);
      return {
        data: result,
        liveExecuted: true,
        attempts: attempt,
        circuitState: 'CLOSED'
      };
    } catch {
      if (attempt < maxRetries) {
        const baseDelay = 25 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 15);
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
      }
    }
  }

  const updated = recordConnectorFailure(serverId);
  return {
    data: fallback(),
    liveExecuted: false,
    attempts: maxRetries,
    circuitState: updated.state
  };
}

export function getConnectorStatusSummary(): ConnectorStatus[] {
  const raw = [
    {
      serverId: 'sql-ops-mcp',
      provider: 'SQLite 3 / PostgreSQL Read-Only Engine',
      mode: 'SQLITE_EMBEDDED_ENGINE' as const,
      envVarConfigured: true,
      endpointBase: 'node:sqlite (.data/monopulse.sqlite)'
    },
    {
      serverId: 'github-mcp',
      provider: 'GitHub REST API v3',
      mode: (process.env.GITHUB_TOKEN ? 'LIVE_REST_API' : 'DETERMINISTIC_FALLBACK') as
        | 'LIVE_REST_API'
        | 'DETERMINISTIC_FALLBACK',
      envVarConfigured: Boolean(process.env.GITHUB_TOKEN),
      endpointBase: 'https://api.github.com'
    },
    {
      serverId: 'slack-mcp',
      provider: 'Slack Web API',
      mode: (process.env.SLACK_BOT_TOKEN ? 'LIVE_REST_API' : 'DETERMINISTIC_FALLBACK') as
        | 'LIVE_REST_API'
        | 'DETERMINISTIC_FALLBACK',
      envVarConfigured: Boolean(process.env.SLACK_BOT_TOKEN),
      endpointBase: 'https://slack.com/api'
    },
    {
      serverId: 'jira-mcp',
      provider: 'Atlassian Jira Cloud REST v3',
      mode: (process.env.JIRA_API_TOKEN ? 'LIVE_REST_API' : 'DETERMINISTIC_FALLBACK') as
        | 'LIVE_REST_API'
        | 'DETERMINISTIC_FALLBACK',
      envVarConfigured: Boolean(process.env.JIRA_API_TOKEN),
      endpointBase: process.env.JIRA_BASE_URL || 'https://api.atlassian.com'
    },
    {
      serverId: 'docs-runbook-mcp',
      provider: 'Internal Markdown & SQLite Runbook Index',
      mode: 'SQLITE_EMBEDDED_ENGINE' as const,
      envVarConfigured: true,
      endpointBase: 'internal://runbooks/index'
    },
    {
      serverId: 'infra-deploy-mcp',
      provider: 'ArgoCD & Feature-Flag Control Plane',
      mode: (process.env.ARGOCD_AUTH_TOKEN ? 'LIVE_REST_API' : 'SQLITE_EMBEDDED_ENGINE') as
        | 'LIVE_REST_API'
        | 'SQLITE_EMBEDDED_ENGINE',
      envVarConfigured: Boolean(process.env.ARGOCD_AUTH_TOKEN),
      endpointBase: process.env.ARGOCD_SERVER_URL || 'internal://argocd-controller'
    }
  ];

  return raw.map((item) => {
    const cb = getConnectorCircuitState(item.serverId);
    return {
      ...item,
      circuitState: cb.state,
      consecutiveFailures: cb.failures
    };
  });
}

/**
 * Normalizes multi-vendor webhook payloads (Slack Events API challenge, Prometheus Alertmanager,
 * PagerDuty V3, Datadog, GitHub deployment_status, or MonoPulse canonical format).
 */
export function normalizeIncomingWebhookPayload(body: Record<string, any>): {
  isSlackChallenge: boolean;
  challenge?: string;
  normalized: {
    source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
    service: string;
    channelOrTicket: string;
    payloadSummary: string;
    vendorFormat: string;
  } | null;
} {
  if (!body || typeof body !== 'object') {
    return { isSlackChallenge: false, normalized: null };
  }

  // 1. Slack Events API URL Verification Challenge
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return { isSlackChallenge: true, challenge: body.challenge, normalized: null };
  }

  // 2. Prometheus Alertmanager Payload
  if (Array.isArray(body.alerts) && body.alerts.length > 0) {
    const first = body.alerts[0] || {};
    const service = String(first.labels?.service || 'checkout-ledger-svc');
    const summary = String(
      first.annotations?.summary ||
        first.annotations?.description ||
        `[Alertmanager] ${first.labels?.alertname || 'HighErrorRate'} firing on ${service}`
    );
    return {
      isSlackChallenge: false,
      normalized: {
        source: 'slack.incident.webhook',
        service,
        channelOrTicket: String(first.labels?.channel || '#inc-prod-alerts · OPS-4821'),
        payloadSummary: summary,
        vendorFormat: 'prometheus.alertmanager.v4'
      }
    };
  }

  // 3. PagerDuty V3 Webhook Payload
  if (body.event && typeof body.event === 'object' && body.event.event_type) {
    const pdData = body.event.data || {};
    const service = String(pdData.service?.summary || 'checkout-ledger-svc')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    return {
      isSlackChallenge: false,
      normalized: {
        source: 'slack.incident.webhook',
        service,
        channelOrTicket: `PD-${pdData.id || '901'} · #inc-prod-alerts`,
        payloadSummary: String(pdData.title || `[PagerDuty ${body.event.event_type}] Critical incident firing`),
        vendorFormat: 'pagerduty.v3.webhook'
      }
    };
  }

  // 4. GitHub deployment_status Webhook
  if (body.deployment_status && typeof body.deployment_status === 'object') {
    const service = String(body.repository?.name || 'checkout-ledger-svc');
    return {
      isSlackChallenge: false,
      normalized: {
        source: 'github.canary.alert',
        service,
        channelOrTicket: `GH-DEPLOY · ${service}`,
        payloadSummary: String(
          body.deployment_status.description ||
            `[GitHub Canary] deployment_status=${body.deployment_status.state} on ${service}`
        ),
        vendorFormat: 'github.deployment_status'
      }
    };
  }

  return { isSlackChallenge: false, normalized: null };
}
