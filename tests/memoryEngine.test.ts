import { describe, expect, it } from 'vitest';
import {
  computeDeterministicEmbedding,
  cosineSimilarity,
  distillTrajectoryViaKaggleGPU,
  PGVECTOR_PLAYBOOKS,
  searchPlaybooksBySemanticSimilarity
} from '../src/server/memoryEngine.ts';

describe('Two-Tier Memory Engine & Kaggle GPU Playbook Extractor', () => {
  it('produces stable, L2-normalized deterministic embeddings for fixed strings', () => {
    const input = 'PgBouncer connection pool exhaustion on checkout-ledger-svc canary dep-9042';
    const vec1 = computeDeterministicEmbedding(input, 64);
    const vec2 = computeDeterministicEmbedding(input, 64);

    expect(vec1).toHaveLength(64);
    expect(vec1).toEqual(vec2);

    const normSq = vec1.reduce((acc, v) => acc + v * v, 0);
    expect(normSq).toBeCloseTo(1.0, 2);
  });

  it('computes higher cosine similarity for semantically matching operational incidents', () => {
    const ledgerQuery = computeDeterministicEmbedding(
      'PgBouncer pool exhaustion FOR UPDATE lock contention checkout-ledger-svc',
      64
    );
    const ledgerTarget = computeDeterministicEmbedding(
      'PgBouncer connection pool saturation 98% FOR UPDATE lock rollback dep-9042',
      64
    );
    const unrelatedWebhook = computeDeterministicEmbedding(
      'EU cross-region webhook ETIMEDOUT TLS handshake 400ms',
      64
    );

    const matchingSim = cosineSimilarity(ledgerQuery, ledgerTarget);
    const unrelatedSim = cosineSimilarity(ledgerQuery, unrelatedWebhook);

    expect(matchingSim).toBeGreaterThan(unrelatedSim);
    expect(matchingSim).toBeGreaterThan(0.75);
  });

  it('searches Tier-2 pgvector playbooks and dynamically injects matched skill into system prompt', async () => {
    const res = await searchPlaybooksBySemanticSimilarity(
      'PgBouncer connection pool exhaustion and FOR UPDATE lock on checkout-ledger-svc',
      3
    );

    expect(res.matches.length).toBeGreaterThan(0);
    expect(res.constructedSystemPrompt).toContain('DYNAMICALLY INJECTED PLAYBOOK');
  });

  it('distills a multi-step agent trajectory via Kaggle GPU bridge and indexes a new playbook', async () => {
    const initialCount = PGVECTOR_PLAYBOOKS.length;
    const outcome = await distillTrajectoryViaKaggleGPU({
      trajectoryId: 'traj-test-991',
      incidentSummary: 'P0 checkout-ledger-svc PgBouncer pool saturation',
      service: 'checkout-ledger-svc',
      executedTools: [
        {
          toolName: 'sql_execute_readonly_query',
          args: { query: 'SELECT * FROM deployments' },
          outcomeSummary: 'Found active canary dep-9042'
        },
        {
          toolName: 'github_get_pr_diff',
          args: { pr_number: 1842 },
          outcomeSummary: 'Detected unbounded FOR UPDATE lock'
        }
      ]
    });

    expect(outcome.job.status).toBe('COMPLETED');
    expect(outcome.job.stepReductionPct).toBeGreaterThan(25);
    expect(PGVECTOR_PLAYBOOKS.length).toBe(initialCount + 1);
    expect(outcome.newPlaybook.targetServices).toContain('checkout-ledger-svc');
  });
});
