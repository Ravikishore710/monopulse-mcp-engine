import React, { useState } from 'react';
import {
  KaggleDistillationJob,
  PgVectorPlaybook,
  RedisTier1Entry
} from '../types/monopulse.ts';

interface MemoryPanelProps {
  avgStepReductionPct: number;
  pgvectorPlaybooks: PgVectorPlaybook[];
  redisTier1: RedisTier1Entry[];
  kaggleGpuJobs: KaggleDistillationJob[];
  selectedEventId: string;
  onRefreshState: () => Promise<void>;
}

export function MemoryPanel({
  avgStepReductionPct,
  pgvectorPlaybooks,
  redisTier1,
  kaggleGpuJobs,
  selectedEventId,
  onRefreshState
}: MemoryPanelProps) {
  const [semanticQuery, setSemanticQuery] = useState<string>(
    'PgBouncer connection pool exhaustion and HTTP 5xx spike on checkout-ledger-svc canary'
  );
  const [semanticSearchRes, setSemanticSearchRes] = useState<any>(null);
  const [searchingMemory, setSearchingMemory] = useState(false);
  const [runningKaggleJob, setRunningKaggleJob] = useState(false);
  const [distillService, setDistillService] = useState<string>('checkout-ledger-svc');
  const [distillSummary, setDistillSummary] = useState<string>(
    'Distill multi-step PgBouncer lock contention trajectory into a zero-question ambient playbook skill.'
  );

  const handleRunSemanticSearch = async (overrideQuery?: string) => {
    setSearchingMemory(true);
    const q = overrideQuery ?? semanticQuery;
    if (overrideQuery) setSemanticQuery(overrideQuery);
    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, topK: 3 })
      });
      const data = await res.json();
      setSemanticSearchRes(data);
    } finally {
      setSearchingMemory(false);
    }
  };

  const handleDistillViaKaggle = async () => {
    setRunningKaggleJob(true);
    try {
      await fetch('/api/kaggle/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEventId,
          customService: distillService,
          customIncidentSummary: distillSummary
        })
      });
      await onRefreshState();
    } finally {
      setRunningKaggleJob(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1F2937] pb-4">
        <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
          03. Two-Tier Shared Memory (pgvector + Redis) &amp; Kaggle GPU Playbook Extractor
        </h1>
        <p className="text-xs text-[#9CA3AF] mt-1">
          Distills successful multi-step agent trajectories into reusable Markdown skills on Kaggle GPU and dynamically injects them into the system prompt via cosine similarity—reducing steps-to-completion by {avgStepReductionPct}%.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F9FAFB]">
              Tier-2 pgvector Semantic Similarity Search &amp; Prompt Skill Injector
            </h2>
            <span className="text-xs font-mono text-[#9CA3AF]">gemini-embedding-2-preview</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={semanticQuery}
              onChange={(e) => setSemanticQuery(e.target.value)}
              placeholder="Enter incoming incident query to compute cosine similarity..."
              className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
            />
            <button
              onClick={() => handleRunSemanticSearch()}
              disabled={searchingMemory}
              className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              {searchingMemory ? 'Embedding...' : 'Search pgvector'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9CA3AF]">
            <span>Sample Queries:</span>
            <button
              onClick={() =>
                handleRunSemanticSearch(
                  'PgBouncer connection pool exhaustion 98% FOR UPDATE lock on checkout-ledger-svc'
                )
              }
              className="underline hover:text-[#F9FAFB] cursor-pointer"
            >
              PgBouncer Lock Contention
            </button>
            <span>·</span>
            <button
              onClick={() =>
                handleRunSemanticSearch(
                  'EU cross-region webhook ETIMEDOUT TLS handshake 400ms on webhook-dispatcher-v2'
                )
              }
              className="underline hover:text-[#F9FAFB] cursor-pointer"
            >
              Webhook TLS Timeout
            </button>
            <span>·</span>
            <button
              onClick={() =>
                handleRunSemanticSearch('PostgreSQL read replica WAL replay lag degraded')
              }
              className="underline hover:text-[#F9FAFB] cursor-pointer"
            >
              Replica WAL Lag
            </button>
          </div>

          {semanticSearchRes && (
            <div className="space-y-3 pt-2 border-t border-[#1F2937]">
              <div className="text-xs font-mono text-[#9CA3AF] tabular-nums">
                Model: {semanticSearchRes.embeddingModelUsed} · Query Vector [0..7]: [
                {semanticSearchRes.queryVectorPreview?.join(', ')}]
              </div>
              <div className="space-y-2">
                {semanticSearchRes.matches?.map((m: any) => (
                  <div
                    key={m.playbook.id}
                    className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] flex items-center justify-between text-xs font-mono"
                  >
                    <div>
                      <span className="text-[#F9FAFB] font-semibold">{m.playbook.id}</span>
                      <span className="mx-2 text-[#9CA3AF]">·</span>
                      <span className="text-[#9CA3AF] font-sans">{m.playbook.title}</span>
                    </div>
                    <div className="tabular-nums shrink-0">
                      <span className="text-[#16A34A]">sim={m.cosineSimilarity}</span>
                      <span className="mx-2 text-[#9CA3AF]">·</span>
                      <span>-{m.playbook.stepReductionPct}% steps</span>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs font-semibold text-[#9CA3AF] mb-1">
                  Dynamically Constructed System Prompt Preview:
                </div>
                <pre className="p-3 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#F9FAFB] overflow-x-auto whitespace-pre-wrap">
                  {semanticSearchRes.constructedSystemPrompt}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F9FAFB]">
              Kaggle GPU Trajectory Distiller Bridge
            </h2>
            <span className="text-xs font-mono text-[#D97706]">NVIDIA_T4_X2</span>
          </div>
          <p className="text-xs text-[#9CA3AF] leading-relaxed">
            Offloads batch trajectory distillation and high-dimensional vectorization to Kaggle GPU kernels, converting raw multi-step traces into deterministic Markdown skills.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#9CA3AF] mb-1">Target Service</label>
              <select
                value={distillService}
                onChange={(e) => setDistillService(e.target.value)}
                className="w-full bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs font-mono text-[#F9FAFB]"
              >
                <option value="checkout-ledger-svc">checkout-ledger-svc</option>
                <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
                <option value="auth-token-gateway">auth-token-gateway</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#9CA3AF] mb-1">
                Trajectory Context to Distill
              </label>
              <textarea
                rows={2}
                value={distillSummary}
                onChange={(e) => setDistillSummary(e.target.value)}
                className="w-full bg-[#0B0F17] border border-[#1F2937] rounded p-2.5 text-xs text-[#F9FAFB]"
              />
            </div>
            <button
              onClick={handleDistillViaKaggle}
              disabled={runningKaggleJob}
              className="w-full py-2 px-4 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              {runningKaggleJob
                ? 'Running Kaggle GPU Distillation Kernel...'
                : 'Run Playbook Extractor on Kaggle GPU'}
            </button>
          </div>

          <div className="pt-3 border-t border-[#1F2937] space-y-2">
            <div className="text-xs font-semibold text-[#9CA3AF]">
              Recent Kaggle GPU Distillation Jobs ({kaggleGpuJobs.length})
            </div>
            {kaggleGpuJobs.slice(0, 3).map((job) => (
              <div
                key={job.jobId}
                className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] text-xs font-mono space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#F9FAFB] font-semibold">{job.jobId}</span>
                  <span className="text-[#16A34A] tabular-nums">
                    {job.rawStepCount} → {job.distilledStepCount} steps (-{job.stepReductionPct}%)
                  </span>
                </div>
                <div className="text-[11px] text-[#9CA3AF] truncate">
                  Kernel: {job.kernelSlug} · {job.accelerator} · {job.computeDurationMs}ms
                </div>
                <div className="text-[11px] text-[#2563EB]">
                  Extracted Skill: {job.extractedPlaybookId}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
          <div className="text-sm font-semibold text-[#F9FAFB]">
            Tier-2 PostgreSQL / pgvector Playbook Vault ({pgvectorPlaybooks.length} Skills Indexed)
          </div>
          <div className="space-y-3">
            {pgvectorPlaybooks.map((pb) => (
              <div
                key={pb.id}
                className="p-4 rounded border border-[#1F2937] bg-[#0B0F17] space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <span className="text-[#2563EB] font-semibold">{pb.id}</span>
                  <span className="tabular-nums text-[#16A34A]">
                    Steps: {pb.baselineStepsWithoutPlaybook} → {pb.distilledStepsWithPlaybook} (-
                    {pb.stepReductionPct}%) · Used {pb.usageCount}x
                  </span>
                </div>
                <div className="text-sm font-semibold text-[#F9FAFB]">{pb.title}</div>
                <div className="text-xs font-mono text-[#9CA3AF]">
                  Trigger: {pb.triggerSignature}
                </div>
                <pre className="p-3 bg-[#111827] rounded border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] overflow-x-auto whitespace-pre-wrap">
                  {pb.markdownSkill}
                </pre>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
          <div className="text-sm font-semibold text-[#F9FAFB]">
            Tier-1 Redis Hot Session &amp; Approval Lock Store ({redisTier1.length} Keys)
          </div>
          <div className="space-y-2.5">
            {redisTier1.map((entry) => (
              <div
                key={entry.key}
                className="p-3.5 rounded border border-[#1F2937] bg-[#0B0F17] space-y-1.5 text-xs font-mono"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#F9FAFB] font-semibold truncate">{entry.key}</span>
                  <span className="text-[#D97706] tabular-nums shrink-0">
                    TTL {entry.ttlSeconds}s
                  </span>
                </div>
                <pre className="text-[11px] text-[#9CA3AF] overflow-x-auto">
                  {JSON.stringify(entry.value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
