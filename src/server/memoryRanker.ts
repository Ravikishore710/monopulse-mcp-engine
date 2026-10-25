import { PGVECTOR_PLAYBOOKS, PgVectorPlaybook } from './memoryEngine.ts';
import { getSqliteDb } from './sqliteEngine.ts';
import { ensureDurableLedgerTables } from './durableLedger.ts';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'after',
  'from',
  'into',
  'during',
  'this',
  'that',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'over',
  'under',
  'when',
  'where',
  'which'
]);

/**
 * Lightweight Porter-style suffix stemmer for SRE & infrastructure vocabulary
 */
export function stemOperationalToken(word: string): string {
  const clean = word.toLowerCase().trim();
  if (clean.length <= 3) return clean;
  if (clean.startsWith('rollback') || clean.startsWith('rolling') || clean.startsWith('rolled')) {
    return 'roll';
  }
  return clean
    .replace(/(saturated|saturation)$/, 'saturat')
    .replace(/(exhausted|exhaustion)$/, 'exhaust')
    .replace(/(ation|ition|tion|sion)$/, 't')
    .replace(/(ing|ed|es|s)$/, '');
}

export function tokenizeAndStemQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .map(stemOperationalToken);
}

/**
 * Reciprocal Rank Fusion (RRF): RRF(d) = 1 / (k + rank_dense(d)) + 1 / (k + rank_bm25(d))
 */
export function computeReciprocalRankFusion(
  denseRankIndex: number,
  bm25RankIndex: number,
  k = 60
): number {
  const rrfRaw = 1 / (k + denseRankIndex + 1) + 1 / (k + bm25RankIndex + 1);
  // Normalize RRF (max theoretical when both rank #0 is 2 / (k + 1)) to [0, 0.12] boost range
  const maxRrf = 2 / (k + 1);
  return (rrfRaw / maxRrf) * 0.08;
}

const feedbackVotes = new Map<string, { upvotes: number; downvotes: number }>();

export function recordPlaybookFeedback(params: {
  playbookId: string;
  vote: 'upvote' | 'downvote';
  editedMarkdown?: string;
}): {
  found: boolean;
  playbook?: PgVectorPlaybook;
  upvotes: number;
  downvotes: number;
  confidenceMultiplier: number;
} {
  const pb = PGVECTOR_PLAYBOOKS.find((p) => p.id === params.playbookId);
  if (!pb) {
    return { found: false, upvotes: 0, downvotes: 0, confidenceMultiplier: 1 };
  }

  const current = feedbackVotes.get(pb.id) || { upvotes: 0, downvotes: 0 };
  if (params.vote === 'upvote') {
    current.upvotes += 1;
    pb.usageCount += 1;
  } else {
    current.downvotes += 1;
  }
  if (params.editedMarkdown && params.editedMarkdown.trim().length > 10) {
    pb.markdownSkill = params.editedMarkdown.trim();
  }
  feedbackVotes.set(pb.id, current);

  ensureDurableLedgerTables();
  const db = getSqliteDb();
  db.prepare(
    `INSERT OR REPLACE INTO durable_playbooks (playbook_id, title, win_rate_pct, upvotes, downvotes, playbook_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pb.id,
    pb.title,
    pb.stepReductionPct,
    current.upvotes,
    current.downvotes,
    JSON.stringify(pb),
    new Date().toISOString()
  );

  const netVotes = current.upvotes - current.downvotes;
  const confidenceMultiplier = Math.max(0.75, Math.min(1.15, 1 + netVotes * 0.03));

  return {
    found: true,
    playbook: pb,
    upvotes: current.upvotes,
    downvotes: current.downvotes,
    confidenceMultiplier: Number(confidenceMultiplier.toFixed(3))
  };
}

export function getPlaybookConfidenceBoost(playbookId: string): number {
  const v = feedbackVotes.get(playbookId);
  if (!v) return 0;
  return Math.max(-0.1, Math.min(0.08, (v.upvotes - v.downvotes) * 0.02));
}
