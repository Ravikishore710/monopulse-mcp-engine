export interface SqlTableSchema {
  tableName: string;
  description: string;
  columns: { name: string; type: string; nullable: boolean; description: string }[];
  rows: Record<string, any>[];
}

export interface GithubPR {
  pr_number: number;
  repo: string;
  title: string;
  author: string;
  branch: string;
  status: 'open' | 'merged' | 'closed';
  ci_status: 'failing' | 'passing' | 'pending';
  changed_files: string[];
  diff_summary: string;
  checks: { name: string; status: string; duration_s: number; log_excerpt: string }[];
  comments: { id: string; author: string; body: string; created_at: string }[];
}

export interface SlackThread {
  thread_ts: string;
  channel_id: string;
  channel_name: string;
  topic: string;
  messages: { user: string; role: string; ts: string; text: string }[];
  approval_blocks: {
    block_id: string;
    event_id: string;
    summary: string;
    status: 'STAGED' | 'APPROVED' | 'EDITED_AND_APPROVED';
    posted_at: string;
  }[];
}

export interface JiraTicket {
  key: string;
  summary: string;
  priority: 'P0-Critical' | 'P1-High' | 'P2-Medium';
  status: 'Open' | 'Investigating' | 'Mitigated' | 'Resolved';
  service: string;
  assignee: string;
  reporter: string;
  created_at: string;
  sla_remaining_min: number;
  root_cause_notes: string;
  description: string;
}

export interface InternalDoc {
  doc_id: string;
  service: string;
  title: string;
  category: 'Runbook' | 'Postmortem' | 'Architecture';
  last_updated: string;
  markdown_body: string;
  proposed_patches: { id: string; author: string; diff: string; status: string; timestamp: string }[];
}

export const SQL_TABLES: Record<string, SqlTableSchema> = {
  deployments: {
    tableName: 'deployments',
    description: 'Production microservice release ledger and canary rollout telemetry',
    columns: [
      { name: 'deploy_id', type: 'VARCHAR(32)', nullable: false, description: 'Primary deployment identifier' },
      { name: 'service', type: 'VARCHAR(64)', nullable: false, description: 'Microservice name' },
      { name: 'git_sha', type: 'CHAR(7)', nullable: false, description: 'Commit SHA' },
      { name: 'pr_number', type: 'INTEGER', nullable: false, description: 'Associated GitHub PR' },
      { name: 'author', type: 'VARCHAR(64)', nullable: false, description: 'Deploying engineer' },
      { name: 'canary_weight_pct', type: 'INTEGER', nullable: false, description: 'Current traffic percentage' },
      { name: 'status', type: 'VARCHAR(24)', nullable: false, description: 'ACTIVE_CANARY | PROMOTED | ROLLED_BACK' },
      { name: 'deployed_at', type: 'TIMESTAMPTZ', nullable: false, description: 'UTC deployment timestamp' }
    ],
    rows: [
      {
        deploy_id: 'dep-9042',
        service: 'checkout-ledger-svc',
        git_sha: 'a8f31c9',
        pr_number: 1842,
        author: 'mchen',
        canary_weight_pct: 25,
        status: 'ACTIVE_CANARY',
        deployed_at: '2026-10-25T15:18:00Z'
      },
      {
        deploy_id: 'dep-9041',
        service: 'auth-token-gateway',
        git_sha: '7d22e10',
        pr_number: 1839,
        author: 'kpatel',
        canary_weight_pct: 100,
        status: 'PROMOTED',
        deployed_at: '2026-10-25T12:40:00Z'
      },
      {
        deploy_id: 'dep-9039',
        service: 'webhook-dispatcher-v2',
        git_sha: 'c4190ab',
        pr_number: 1835,
        author: 'arivera',
        canary_weight_pct: 100,
        status: 'PROMOTED',
        deployed_at: '2026-10-25T09:15:00Z'
      }
    ]
  },
  service_incidents: {
    tableName: 'service_incidents',
    description: 'Real-time anomaly metrics and p99 latency spikes per service',
    columns: [
      { name: 'incident_id', type: 'VARCHAR(32)', nullable: false, description: 'Incident ID' },
      { name: 'service', type: 'VARCHAR(64)', nullable: false, description: 'Service identifier' },
      { name: 'error_rate_pct', type: 'NUMERIC(5,2)', nullable: false, description: '5xx HTTP error rate percentage' },
      { name: 'p99_latency_ms', type: 'INTEGER', nullable: false, description: '99th percentile latency in ms' },
      { name: 'db_pool_exhaustion_pct', type: 'INTEGER', nullable: false, description: 'PgBouncer connection saturation' },
      { name: 'jira_key', type: 'VARCHAR(24)', nullable: false, description: 'Linked Jira incident key' }
    ],
    rows: [
      {
        incident_id: 'inc-409',
        service: 'checkout-ledger-svc',
        error_rate_pct: 14.8,
        p99_latency_ms: 4820,
        db_pool_exhaustion_pct: 98,
        jira_key: 'OPS-4821'
      },
      {
        incident_id: 'inc-408',
        service: 'webhook-dispatcher-v2',
        error_rate_pct: 3.4,
        p99_latency_ms: 1290,
        db_pool_exhaustion_pct: 64,
        jira_key: 'OPS-4819'
      },
      {
        incident_id: 'inc-407',
        service: 'auth-token-gateway',
        error_rate_pct: 0.12,
        p99_latency_ms: 82,
        db_pool_exhaustion_pct: 31,
        jira_key: 'OPS-4812'
      }
    ]
  },
  customer_orgs: {
    tableName: 'customer_orgs',
    description: 'Enterprise tenant metadata and affected SLA tiers',
    columns: [
      { name: 'org_id', type: 'VARCHAR(32)', nullable: false, description: 'Tenant UUID' },
      { name: 'org_name', type: 'VARCHAR(128)', nullable: false, description: 'Enterprise organization name' },
      { name: 'sla_tier', type: 'VARCHAR(32)', nullable: false, description: 'ENTERPRISE_9999 | GROWTH_999' },
      { name: 'active_region', type: 'VARCHAR(32)', nullable: false, description: 'Primary cloud region' },
      { name: 'failed_tx_last_15m', type: 'INTEGER', nullable: false, description: 'Failed checkout transactions in last 15m' }
    ],
    rows: [
      {
        org_id: 'org_acme_global',
        org_name: 'Acme Global Logistics',
        sla_tier: 'ENTERPRISE_9999',
        active_region: 'us-east-1',
        failed_tx_last_15m: 342
      },
      {
        org_id: 'org_kestrel_fin',
        org_name: 'Kestrel Financial Systems',
        sla_tier: 'ENTERPRISE_9999',
        active_region: 'us-east-1',
        failed_tx_last_15m: 189
      },
      {
        org_id: 'org_vanguard_med',
        org_name: 'Vanguard BioLabs',
        sla_tier: 'GROWTH_999',
        active_region: 'eu-central-1',
        failed_tx_last_15m: 12
      }
    ]
  },
  feature_flags: {
    tableName: 'feature_flags',
    description: 'Runtime launch flags and runtime kill-switches',
    columns: [
      { name: 'flag_key', type: 'VARCHAR(64)', nullable: false, description: 'Flag key' },
      { name: 'service', type: 'VARCHAR(64)', nullable: false, description: 'Target service' },
      { name: 'enabled', type: 'BOOLEAN', nullable: false, description: 'Whether flag is active' },
      { name: 'rollout_pct', type: 'INTEGER', nullable: false, description: 'Percentage of tenants' },
      { name: 'updated_by', type: 'VARCHAR(64)', nullable: false, description: 'Last modifier' }
    ],
    rows: [
      {
        flag_key: 'enable_sync_ledger_reconciliation_v2',
        service: 'checkout-ledger-svc',
        enabled: true,
        rollout_pct: 25,
        updated_by: 'mchen'
      },
      {
        flag_key: 'strict_webhook_hmac_retry_backoff',
        service: 'webhook-dispatcher-v2',
        enabled: true,
        rollout_pct: 100,
        updated_by: 'arivera'
      },
      {
        flag_key: 'pgvector_hybrid_reranker',
        service: 'monopulse-core',
        enabled: true,
        rollout_pct: 100,
        updated_by: 'system'
      }
    ]
  },
  db_replication_status: {
    tableName: 'db_replication_status',
    description: 'PostgreSQL primary and read-replica WAL replication lag telemetry',
    columns: [
      { name: 'replica_node', type: 'VARCHAR(64)', nullable: false, description: 'Node hostname' },
      { name: 'cluster', type: 'VARCHAR(64)', nullable: false, description: 'Cluster group' },
      { name: 'replication_lag_ms', type: 'INTEGER', nullable: false, description: 'WAL replay lag in ms' },
      { name: 'active_locks', type: 'INTEGER', nullable: false, description: 'Active row/table locks' },
      { name: 'state', type: 'VARCHAR(24)', nullable: false, description: 'STREAMING | DEGRADED' }
    ],
    rows: [
      {
        replica_node: 'pg-ledger-ro-01.us-east-1',
        cluster: 'ledger-prod-cluster',
        replication_lag_ms: 4120,
        active_locks: 47,
        state: 'DEGRADED'
      },
      {
        replica_node: 'pg-ledger-ro-02.us-east-1',
        cluster: 'ledger-prod-cluster',
        replication_lag_ms: 190,
        active_locks: 6,
        state: 'STREAMING'
      },
      {
        replica_node: 'pg-vector-mem-01.us-east-1',
        cluster: 'monopulse-pgvector-cluster',
        replication_lag_ms: 14,
        active_locks: 2,
        state: 'STREAMING'
      }
    ]
  }
};

export const GITHUB_PRS: GithubPR[] = [
  {
    pr_number: 1842,
    repo: 'org-internal/checkout-ledger-svc',
    title: 'feat(ledger): switch reconciliation query to nested FOR UPDATE lock',
    author: 'mchen',
    branch: 'feat/sync-ledger-lock',
    status: 'merged',
    ci_status: 'failing',
    changed_files: [
      'src/repository/LedgerRepository.ts',
      'src/workers/ReconciliationWorker.ts',
      'config/pgbouncer-pool.yaml'
    ],
    diff_summary: `@@ -84,7 +84,9 @@ export async function reconcileTenantBatch(tx: PoolClient, orgId: string) {
-  const rows = await tx.query('SELECT id, amount_cents FROM ledger_entries WHERE org_id = $1 AND settled = false LIMIT 250', [orgId]);
+  // Acquired explicit row lock without SKIP LOCKED across unbounded batch
+  const rows = await tx.query('SELECT id, amount_cents FROM ledger_entries WHERE org_id = $1 FOR UPDATE', [orgId]);
+  await holdAdvisoryReconciliationLock(tx, orgId);`,
    checks: [
      {
        name: 'canary-synthetic-load-test',
        status: 'failing',
        duration_s: 142,
        log_excerpt: 'ERROR: remaining connection slots are reserved for non-replication superuser connections (SQLSTATE 53300)'
      },
      {
        name: 'unit-tests-node22',
        status: 'passing',
        duration_s: 38,
        log_excerpt: '412 passing (1.8s)'
      }
    ],
    comments: [
      {
        id: 'gh-c-101',
        author: 'ci-canary-bot',
        body: 'Canary dep-9042 on us-east-1 showing +14.8% 5xx rate after 25% traffic shift.',
        created_at: '2026-10-25T15:24:00Z'
      }
    ]
  },
  {
    pr_number: 1835,
    repo: 'org-internal/webhook-dispatcher-v2',
    title: 'perf(retry): tighten TLS handshake timeout to 400ms on outbound webhooks',
    author: 'arivera',
    branch: 'perf/tls-timeout-400ms',
    status: 'merged',
    ci_status: 'passing',
    changed_files: ['src/http/WebhookClient.ts', 'src/queue/RetryPolicy.ts'],
    diff_summary: `@@ -22,4 +22,4 @@ export const DEFAULT_WEBHOOK_CLIENT_OPTS = {
-  tlsHandshakeTimeoutMs: 2500,
+  tlsHandshakeTimeoutMs: 400, // Causes premature ETIMEDOUT on cross-region EU endpoints`,
    checks: [
      {
        name: 'integration-suite',
        status: 'passing',
        duration_s: 64,
        log_excerpt: 'All regional mocks passed.'
      }
    ],
    comments: []
  }
];

export const SLACK_THREADS: SlackThread[] = [
  {
    thread_ts: '1761406210.004200',
    channel_id: 'C04INCIDENTS',
    channel_name: '#inc-prod-alerts',
    topic: 'P0 Alert: checkout-ledger-svc 5xx spike & PgBouncer pool exhaustion',
    messages: [
      {
        user: 'pagerduty-bot',
        role: 'webhook',
        ts: '1761406210.004200',
        text: '[FIRING: P0] checkout-ledger-svc HTTP 5xx error rate is 14.8% in us-east-1 (SLA threshold: 1.0%). Linked Jira: OPS-4821.'
      },
      {
        user: 'sre_oncall_dana',
        role: 'sre_admin',
        ts: '1761406245.004300',
        text: 'Seeing Acme Global and Kestrel Financial reporting checkout timeouts. Did a new canary go out on checkout-ledger-svc?'
      },
      {
        user: 'mchen',
        role: 'eng_lead',
        ts: '1761406280.004400',
        text: 'PR #1842 (`a8f31c9`) rolled out to 25% canary 12 mins ago with `enable_sync_ledger_reconciliation_v2`.'
      }
    ],
    approval_blocks: []
  },
  {
    thread_ts: '1761405100.001900',
    channel_id: 'C04SUPPORT_ESC',
    channel_name: '#tier2-customer-escalations',
    topic: 'EU Webhook Delivery Timeouts after 09:15 UTC deploy',
    messages: [
      {
        user: 'support_lead_maya',
        role: 'support_tier2',
        ts: '1761405100.001900',
        text: 'Vanguard BioLabs (`eu-central-1`) is seeing intermittent webhook delivery drops with ETIMEDOUT during TLS handshakes. Ticket OPS-4819.'
      }
    ],
    approval_blocks: []
  }
];

export const JIRA_TICKETS: JiraTicket[] = [
  {
    key: 'OPS-4821',
    summary: 'P0: checkout-ledger-svc PgBouncer pool exhaustion (98%) & 14.8% 5xx rate in us-east-1',
    priority: 'P0-Critical',
    status: 'Investigating',
    service: 'checkout-ledger-svc',
    assignee: 'unassigned',
    reporter: 'datadog-monitor',
    created_at: '2026-10-25T15:22:00Z',
    sla_remaining_min: 14,
    root_cause_notes: '',
    description: 'PgBouncer pool saturation hit 98% on ledger-prod-cluster following canary deployment dep-9042 (commit a8f31c9, PR #1842). Unbounded SELECT ... FOR UPDATE without LIMIT or SKIP LOCKED is holding row locks for 4.8s.'
  },
  {
    key: 'OPS-4819',
    summary: 'P1: Cross-region webhook TLS handshake ETIMEDOUT on eu-central-1 tenants',
    priority: 'P1-High',
    status: 'Open',
    service: 'webhook-dispatcher-v2',
    assignee: 'arivera',
    reporter: 'support_lead_maya',
    created_at: '2026-10-25T14:50:00Z',
    sla_remaining_min: 42,
    root_cause_notes: '',
    description: 'Commit c4190ab (PR #1835) reduced tlsHandshakeTimeoutMs from 2500ms to 400ms, causing cross-Atlantic webhook deliveries to abort prematurely.'
  }
];

export const INTERNAL_DOCS: InternalDoc[] = [
  {
    doc_id: 'RUNBOOK-LEDGER-01',
    service: 'checkout-ledger-svc',
    title: 'Runbook: PgBouncer Connection Pool Exhaustion & Canary Rollback',
    category: 'Runbook',
    last_updated: '2026-10-12',
    markdown_body: `### Symptom
PgBouncer \`cl_waiting\` > 50 and HTTP 5xx > 5% on \`checkout-ledger-svc\`.

### Immediate Verification (Read-Only)
1. Query \`deployments\` table for \`status = 'ACTIVE_CANARY'\` on \`checkout-ledger-svc\`.
2. Inspect \`db_replication_status\` for \`active_locks > 25\`.
3. Inspect recent GitHub PR diffs touching \`LedgerRepository.ts\` for unbounded \`FOR UPDATE\` locks.

### Deterministic Remediation
1. Trigger canary rollback via \`infra_trigger_canary_rollback\` on deployment \`dep-9042\`.
2. Transition Jira incident to \`Mitigated\` and append root cause SHA.
3. Broadcast resolution block to \`#inc-prod-alerts\`.`,
    proposed_patches: []
  },
  {
    doc_id: 'RUNBOOK-WEBHOOK-04',
    service: 'webhook-dispatcher-v2',
    title: 'Runbook: Regional TLS Handshake Timeouts & Retry Backoff',
    category: 'Runbook',
    last_updated: '2026-09-28',
    markdown_body: `### Symptom
Elevated \`ETIMEDOUT\` errors on \`eu-central-1\` or \`ap-southeast-1\` webhook endpoints.

### Verification & Remediation
1. Check \`tlsHandshakeTimeoutMs\` in \`src/http/WebhookClient.ts\` (minimum safe cross-region threshold is 1500ms).
2. Post PR review comment flagging the timeout regression and assign ticket to commit author.`,
    proposed_patches: []
  },
  {
    doc_id: 'POSTMORTEM-2026-08',
    service: 'checkout-ledger-svc',
    title: 'Postmortem: August Advisory Lock Contention during Batch Settlement',
    category: 'Postmortem',
    last_updated: '2026-08-19',
    markdown_body: `### Summary
Unbounded \`SELECT ... FOR UPDATE\` queries without \`SKIP LOCKED\` starved PgBouncer transaction pools within 8 minutes of canary promotion. Always enforce \`LIMIT 250 SKIP LOCKED\` in ledger workers.`,
    proposed_patches: []
  }
];

export const POD_TELEMETRY: Record<string, {
  service: string;
  error_rate_pct: number;
  p99_latency_ms: number;
  active_canary_id: string | null;
  recent_logs: string[];
}> = {
  'checkout-ledger-svc': {
    service: 'checkout-ledger-svc',
    error_rate_pct: 14.8,
    p99_latency_ms: 4820,
    active_canary_id: 'dep-9042',
    recent_logs: [
      '2026-10-25T15:23:11.104Z [ERROR] [pod/checkout-ledger-canary-7f9b] PgBouncerPoolError: timeout of 4500ms exceeded waiting for idle client',
      '2026-10-25T15:23:12.419Z [WARN]  [pod/checkout-ledger-canary-7f9b] LockWaitTimeout on relation ledger_entries (held by tx 994120, git_sha=a8f31c9)',
      '2026-10-25T15:23:14.002Z [ERROR] [pod/checkout-ledger-canary-6c1a] HTTP 503 Service Unavailable POST /v1/ledger/settle (org_id=org_acme_global)'
    ]
  },
  'webhook-dispatcher-v2': {
    service: 'webhook-dispatcher-v2',
    error_rate_pct: 3.4,
    p99_latency_ms: 1290,
    active_canary_id: null,
    recent_logs: [
      '2026-10-25T15:19:04.210Z [WARN] [pod/webhook-disp-eu-02] TLSHandshakeTimeoutError: handshake exceeded 400ms for endpoint https://hooks.vanguardbiolabs.de/events',
      '2026-10-25T15:19:08.881Z [INFO] [pod/webhook-disp-eu-02] Enqueued retry #3 for org_vanguard_med (git_sha=c4190ab)'
    ]
  },
  'auth-token-gateway': {
    service: 'auth-token-gateway',
    error_rate_pct: 0.12,
    p99_latency_ms: 82,
    active_canary_id: null,
    recent_logs: [
      '2026-10-25T15:24:00.011Z [INFO] [pod/auth-gw-01] JWK rotation check nominal (p99=82ms)'
    ]
  }
};
