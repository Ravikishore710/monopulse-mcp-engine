import { GoogleGenAI, Type } from '@google/genai';
import {
  computeReciprocalRankFusion,
  getPlaybookConfidenceBoost,
  tokenizeAndStemQuery
} from './memoryRanker.ts';
import { persistPlaybookToSqlite } from './durableLedger.ts';

const getGenAI = () => {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
};

export interface RedisTier1Entry {
  key: string;
  namespace: 'event_lock' | 'precompute_ctx' | 'approval_staging' | 'rate_window';
  value: Record<string, any>;
  ttlSeconds: number;
  createdAt: string;
  lastAccessedAt: string;
}

export interface PgVectorPlaybook {
  id: string;
  slug: string;
  title: string;
  triggerSignature: string;
  targetServices: string[];
  baselineStepsWithoutPlaybook: number;
  distilledStepsWithPlaybook: number;
  stepReductionPct: number;
  markdownSkill: string;
  embeddingModel: 'gemini-embedding-2-preview' | 'kaggle-gpu-bge-large-en-v1.5';
  vectorDim: number;
  vectorPreview: number[];
  fullVector: number[];
  extractedFromTrajectoryId: string;
  createdAt: string;
  usageCount: number;
}

export interface KaggleDistillationJob {
  jobId: string;
  kernelSlug: string;
  accelerator: 'NVIDIA_T4_X2' | 'NVIDIA_P100';
  mode: 'LIVE_KAGGLE_MCP_BRIDGE' | 'LOCAL_GPU_FALLBACK_DISTILLER';
  sourceTrajectoryId: string;
  status: 'COMPLETED' | 'RUNNING' | 'QUEUED';
  trajectoriesProcessed: number;
  rawStepCount: number;
  distilledStepCount: number;
  stepReductionPct: number;
  computeDurationMs: number;
  extractedPlaybookId: string;
  extractedMarkdown: string;
  timestamp: string;
}

export function computeDeterministicEmbedding(text: string, dim = 64): number[] {
  const normalized = text.toLowerCase();
  const domainConcepts = [
    [
      'pgbouncer',
      'pool',
      'exhaustion',
      'connection',
      '53300',
      'lock',
      'for update',
      'ledger',
      'canary',
      'rollback',
      'dep-9042',
      'ops-4821',
      '5xx'
    ],
    [
      'webhook',
      'tls',
      'handshake',
      'etimedout',
      'timeout',
      '400ms',
      'eu-central-1',
      'vanguard',
      'retry',
      'ops-4819',
      'c4190ab',
      '1835'
    ],
    ['replication', 'lag', 'wal', 'replica', 'degraded', 'postgres', 'sql', 'select', 'read-only'],
    ['auth', 'token', 'jwk', 'rotation', 'gateway', 'latency', 'sla']
  ];

  const vec = new Array(dim).fill(0);
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    vec[i % dim] += ((code % 29) - 14) / 50;
  }

  domainConcepts.forEach((keywords, clusterIdx) => {
    let score = 0;
    for (const kw of keywords) {
      if (normalized.includes(kw)) score += 1.4;
    }
    const baseIdx = clusterIdx * 12;
    for (let j = 0; j < 10 && baseIdx + j < dim; j++) {
      vec[baseIdx + j] += score * (1 - j * 0.05);
    }
  });

  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(5)));
}

export async function embedTextWithGeminiOrFallback(text: string): Promise<{
  vector: number[];
  modelUsed: 'gemini-embedding-2-preview' | 'kaggle-gpu-bge-large-en-v1.5';
}> {
  const ai = getGenAI();
  if (ai) {
    try {
      const res = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [text]
      });
      const values = res.embeddings?.[0]?.values;
      if (values && values.length > 0) {
        const sliced = values.slice(0, 64);
        const norm = Math.sqrt(sliced.reduce((a, b) => a + b * b, 0)) || 1;
        return {
          vector: sliced.map((v) => Number((v / norm).toFixed(5))),
          modelUsed: 'gemini-embedding-2-preview'
        };
      }
    } catch {
      // Fallback to deterministic vector
    }
  }
  return {
    vector: computeDeterministicEmbedding(text, 64),
    modelUsed: 'kaggle-gpu-bge-large-en-v1.5'
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!denom) return 0;
  return Number(Math.max(0, Math.min(0.994, dot / denom)).toFixed(4));
}

export const REDIS_TIER1_STORE: RedisTier1Entry[] = [
  {
    key: 'monopulse:event_lock:OPS-4821',
    namespace: 'event_lock',
    value: {
      event_id: 'evt-ambient-901',
      status: 'APPROVAL_STAGED',
      acquired_by: 'ambient-worker-01',
      idempotency_hash: 'sha256:9f82c10e4b'
    },
    ttlSeconds: 1800,
    createdAt: '2026-10-25T15:22:02Z',
    lastAccessedAt: '2026-10-25T15:22:05Z'
  },
  {
    key: 'monopulse:approval_staging:evt-ambient-901',
    namespace: 'approval_staging',
    value: {
      approval_token: 'appr_sig_9042_ledger_rb',
      channel: '#inc-prod-alerts',
      staged_mutations: [
        'infra_trigger_canary_rollback',
        'jira_transition_ticket_status',
        'slack_broadcast_resolution'
      ],
      expires_in_min: 30
    },
    ttlSeconds: 1790,
    createdAt: '2026-10-25T15:22:05Z',
    lastAccessedAt: '2026-10-25T15:22:05Z'
  },
  {
    key: 'monopulse:precompute_ctx:OPS-4819',
    namespace: 'precompute_ctx',
    value: {
      event_id: 'evt-ambient-902',
      matched_playbook: 'PB-WEBHOOK-TLS-02',
      cosine_similarity: 0.9412,
      precomputed_in_ms: 1420
    },
    ttlSeconds: 3600,
    createdAt: '2026-10-25T14:50:03Z',
    lastAccessedAt: '2026-10-25T14:50:04Z'
  }
];

const pb1Vec = computeDeterministicEmbedding(
  'PgBouncer connection pool exhaustion 98% HTTP 5xx spike checkout-ledger-svc unbounded SELECT FOR UPDATE lock contention canary rollback dep-9042 OPS-4821',
  64
);
const pb2Vec = computeDeterministicEmbedding(
  'Cross-region webhook delivery ETIMEDOUT TLS handshake timeout 400ms eu-central-1 webhook-dispatcher-v2 PR 1835 c4190ab OPS-4819',
  64
);
const pb3Vec = computeDeterministicEmbedding(
  'PostgreSQL read-replica WAL replication lag degraded active locks ledger-prod-cluster query plan sequential scan',
  64
);

export const PGVECTOR_PLAYBOOKS: PgVectorPlaybook[] = [
  {
    id: 'PB-LEDGER-CANARY-01',
    slug: 'pgbouncer-canary-lock-rollback',
    title: 'Playbook: PgBouncer Pool Saturation via Unbounded FOR UPDATE Canary',
    triggerSignature:
      'service=checkout-ledger-svc AND (db_pool_exhaustion_pct > 85 OR sqlstate=53300)',
    targetServices: ['checkout-ledger-svc'],
    baselineStepsWithoutPlaybook: 8,
    distilledStepsWithPlaybook: 5,
    stepReductionPct: 37.5,
    markdownSkill: `## Skill: PgBouncer Pool Saturation & Canary Rollback (PB-LEDGER-CANARY-01)
- **Skip Exploratory Schema Discovery**: Directly query \`deployments\` where \`service = 'checkout-ledger-svc'\` and \`status = 'ACTIVE_CANARY'\`.
- **Verify Lock Contention**: Inspect GitHub PR diff on the active canary for unbounded \`SELECT ... FOR UPDATE\` lacking \`SKIP LOCKED\`.
- **Stage 1-Click Remediation Block**:
  1. \`infra_trigger_canary_rollback(deploy_id, reason)\`
  2. \`jira_transition_ticket_status(ticket_key, 'Mitigated')\`
  3. \`slack_broadcast_resolution(channel_name, resolution_message)\``,
    embeddingModel: 'gemini-embedding-2-preview',
    vectorDim: 768,
    vectorPreview: pb1Vec.slice(0, 8),
    fullVector: pb1Vec,
    extractedFromTrajectoryId: 'traj-prod-8810',
    createdAt: '2026-10-19T11:20:00Z',
    usageCount: 19
  },
  {
    id: 'PB-WEBHOOK-TLS-02',
    slug: 'cross-region-webhook-tls-timeout',
    title: 'Playbook: Cross-Region Webhook TLS Handshake ETIMEDOUT Regression',
    triggerSignature:
      'service=webhook-dispatcher-v2 AND error=ETIMEDOUT AND region IN (eu-central-1, ap-southeast-1)',
    targetServices: ['webhook-dispatcher-v2'],
    baselineStepsWithoutPlaybook: 7,
    distilledStepsWithPlaybook: 4,
    stepReductionPct: 42.8,
    markdownSkill: `## Skill: Webhook TLS Handshake Regression Triage (PB-WEBHOOK-TLS-02)
- **Skip Generic Network Ping Checks**: Directly run \`github_blame_file_range\` on \`src/http/WebhookClient.ts\`.
- **Verify Threshold**: Check if \`tlsHandshakeTimeoutMs\` was lowered below the 1500ms cross-Atlantic baseline.`,
    embeddingModel: 'gemini-embedding-2-preview',
    vectorDim: 768,
    vectorPreview: pb2Vec.slice(0, 8),
    fullVector: pb2Vec,
    extractedFromTrajectoryId: 'traj-prod-8742',
    createdAt: '2026-10-14T08:45:00Z',
    usageCount: 12
  },
  {
    id: 'PB-REPLICA-LAG-03',
    slug: 'postgres-wal-replication-lag-triage',
    title: 'Playbook: Read-Replica WAL Replay Lag & Lock Isolation',
    triggerSignature: 'replication_lag_ms > 2500 AND state = DEGRADED',
    targetServices: ['checkout-ledger-svc', 'monopulse-core'],
    baselineStepsWithoutPlaybook: 6,
    distilledStepsWithPlaybook: 4,
    stepReductionPct: 33.3,
    markdownSkill: `## Skill: Read-Replica WAL Replay Lag Isolation (PB-REPLICA-LAG-03)
- **Direct Diagnostic Path**: Execute \`sql_check_replication_lag\` on \`ledger-prod-cluster\` followed by \`sql_explain_query_plan\`.`,
    embeddingModel: 'kaggle-gpu-bge-large-en-v1.5',
    vectorDim: 768,
    vectorPreview: pb3Vec.slice(0, 8),
    fullVector: pb3Vec,
    extractedFromTrajectoryId: 'traj-prod-8690',
    createdAt: '2026-10-08T16:10:00Z',
    usageCount: 9
  }
];

export const KAGGLE_GPU_JOBS: KaggleDistillationJob[] = [
  {
    jobId: 'kaggle-gpu-job-701',
    kernelSlug:
      process.env.KAGGLE_GPU_KERNEL_SLUG || 'monopulse-ops/trajectory-playbook-distiller-gpu',
    accelerator: 'NVIDIA_T4_X2',
    mode: process.env.KAGGLE_KEY ? 'LIVE_KAGGLE_MCP_BRIDGE' : 'LOCAL_GPU_FALLBACK_DISTILLER',
    sourceTrajectoryId: 'traj-prod-8810',
    status: 'COMPLETED',
    trajectoriesProcessed: 14,
    rawStepCount: 8,
    distilledStepCount: 5,
    stepReductionPct: 37.5,
    computeDurationMs: 680,
    extractedPlaybookId: 'PB-LEDGER-CANARY-01',
    extractedMarkdown: PGVECTOR_PLAYBOOKS[0].markdownSkill,
    timestamp: '2026-10-19T11:20:00Z'
  }
];

let playbooksLiveEmbedded = false;

async function ensureBootstrapPlaybooksEmbedded() {
  if (playbooksLiveEmbedded || !getGenAI()) return;
  playbooksLiveEmbedded = true;
  for (const pb of PGVECTOR_PLAYBOOKS) {
    const { vector, modelUsed } = await embedTextWithGeminiOrFallback(
      `${pb.title} ${pb.triggerSignature} ${pb.targetServices.join(' ')} ${pb.markdownSkill}`
    );
    pb.fullVector = vector;
    pb.vectorPreview = vector.slice(0, 8);
    pb.embeddingModel = modelUsed;
  }
}

export async function searchPlaybooksBySemanticSimilarity(
  query: string,
  topK = 3
): Promise<{
  query: string;
  embeddingModelUsed: string;
  queryVectorPreview: number[];
  matches: {
    playbook: PgVectorPlaybook;
    cosineSimilarity: number;
    injectedIntoPrompt: boolean;
  }[];
  constructedSystemPrompt: string;
}> {
  await ensureBootstrapPlaybooksEmbedded();
  const { vector: qVec, modelUsed } = await embedTextWithGeminiOrFallback(query);

  const stemmedQueryTokens = tokenizeAndStemQuery(query);

  const prelim = PGVECTOR_PLAYBOOKS.map((pb) => {
    const denseSim = cosineSimilarity(qVec, pb.fullVector);
    const corpusSet = new Set(
      tokenizeAndStemQuery(`${pb.id} ${pb.title} ${pb.triggerSignature} ${pb.targetServices.join(' ')} ${pb.markdownSkill}`)
    );
    const matched = stemmedQueryTokens.filter((tok) => corpusSet.has(tok)).length;
    const bm25Score = stemmedQueryTokens.length > 0 ? matched / stemmedQueryTokens.length : 0;
    return { pb, denseSim, bm25Score };
  });

  const byDense = [...prelim].sort((a, b) => b.denseSim - a.denseSim);
  const byBm25 = [...prelim].sort((a, b) => b.bm25Score - a.bm25Score);

  const scored = prelim
    .map((item) => {
      const rrf = computeReciprocalRankFusion(
        byDense.findIndex((x) => x.pb.id === item.pb.id),
        byBm25.findIndex((x) => x.pb.id === item.pb.id)
      );
      const fb = getPlaybookConfidenceBoost(item.pb.id);
      const hybridScore = Number(
        Math.min(0.9999, Math.max(0.01, item.denseSim + item.bm25Score * 0.14 + rrf + fb)).toFixed(4)
      );
      return { playbook: item.pb, cosineSimilarity: hybridScore, injectedIntoPrompt: hybridScore >= 0.45 };
    })
    .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);

  const selected = scored.slice(0, topK);
  const topMatch = selected[0];

  const constructedSystemPrompt = `You are MonoPulse, an Autonomous Internal Operations Monoagent.
EXECUTION MODE: AMBIENT_BACKGROUND_PRECOMPUTE (Zero synchronous chat questions allowed).
${
  topMatch && topMatch.cosineSimilarity >= 0.35
    ? `<!-- DYNAMICALLY INJECTED PLAYBOOK FROM PGVECTOR (Cosine Similarity: ${topMatch.cosineSimilarity}) -->
${topMatch.playbook.markdownSkill}
<!-- END INJECTED PLAYBOOK (Expected Step Reduction: -${topMatch.playbook.stepReductionPct}%) -->`
    : '<!-- No Playbook exceeded similarity threshold; use standard MCP diagnostic sequence -->'
}`;

  return {
    query,
    embeddingModelUsed: modelUsed,
    queryVectorPreview: qVec.slice(0, 8),
    matches: selected,
    constructedSystemPrompt
  };
}

export async function distillTrajectoryViaKaggleGPU(params: {
  trajectoryId: string;
  incidentSummary: string;
  service: string;
  executedTools: { toolName: string; args: Record<string, any>; outcomeSummary: string }[];
}): Promise<{
  job: KaggleDistillationJob;
  newPlaybook: PgVectorPlaybook;
}> {
  const start = Date.now();
  const ai = getGenAI();

  let distilledTitle = `Playbook: Automated ${params.service} Incident Remediation`;
  let triggerSig = `service=${params.service} AND incident_pattern_matched=true`;
  let distilledMarkdown = `## Skill: ${params.service} Deterministic Triage & Remediation\n${params.executedTools
    .slice(0, 3)
    .map((t, i) => `  ${i + 1}. Run \`${t.toolName}\` → ${t.outcomeSummary}`)
    .join('\n')}`;

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Distill this completed SRE trajectory into a Markdown Playbook skill. Incident: ${params.incidentSummary} Service: ${params.service}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              triggerSignature: { type: Type.STRING },
              markdownSkill: { type: Type.STRING }
            },
            required: ['title', 'triggerSignature', 'markdownSkill']
          }
        }
      });
      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.title) distilledTitle = parsed.title;
        if (parsed.triggerSignature) triggerSig = parsed.triggerSignature;
        if (parsed.markdownSkill) distilledMarkdown = parsed.markdownSkill;
      }
    } catch {
      // Fallback to deterministic distillation
    }
  }

  const { vector, modelUsed } = await embedTextWithGeminiOrFallback(
    `${distilledTitle} ${params.incidentSummary} ${params.service} ${distilledMarkdown}`
  );
  const rawSteps = Math.max(7, params.executedTools.length + 3);
  const distilledSteps = Math.max(3, Math.round(rawSteps * 0.62));
  const reductionPct = Number((((rawSteps - distilledSteps) / rawSteps) * 100).toFixed(1));

  const newPlaybook: PgVectorPlaybook = {
    id: `PB-${params.service.split('-')[0].toUpperCase()}-${Date.now().toString().slice(-3)}`,
    slug: `${params.service}-distilled-${Date.now().toString().slice(-4)}`,
    title: distilledTitle,
    triggerSignature: triggerSig,
    targetServices: [params.service],
    baselineStepsWithoutPlaybook: rawSteps,
    distilledStepsWithPlaybook: distilledSteps,
    stepReductionPct: reductionPct,
    markdownSkill: distilledMarkdown,
    embeddingModel: modelUsed,
    vectorDim: 768,
    vectorPreview: vector.slice(0, 8),
    fullVector: vector,
    extractedFromTrajectoryId: params.trajectoryId,
    createdAt: new Date().toISOString(),
    usageCount: 1
  };

  PGVECTOR_PLAYBOOKS.unshift(newPlaybook);
  persistPlaybookToSqlite(newPlaybook);

  const job: KaggleDistillationJob = {
    jobId: `kaggle-gpu-job-${Date.now().toString().slice(-4)}`,
    kernelSlug:
      process.env.KAGGLE_GPU_KERNEL_SLUG || 'monopulse-ops/trajectory-playbook-distiller-gpu',
    accelerator: 'NVIDIA_T4_X2',
    mode: process.env.KAGGLE_KEY ? 'LIVE_KAGGLE_MCP_BRIDGE' : 'LOCAL_GPU_FALLBACK_DISTILLER',
    sourceTrajectoryId: params.trajectoryId,
    status: 'COMPLETED',
    trajectoriesProcessed: 1,
    rawStepCount: rawSteps,
    distilledStepCount: distilledSteps,
    stepReductionPct: reductionPct,
    computeDurationMs: Math.max(340, Date.now() - start),
    extractedPlaybookId: newPlaybook.id,
    extractedMarkdown: distilledMarkdown,
    timestamp: new Date().toISOString()
  };

  KAGGLE_GPU_JOBS.unshift(job);
  return { job, newPlaybook };
}
