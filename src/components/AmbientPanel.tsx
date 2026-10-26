import React, { useState } from 'react';
import { Check, Cpu, Edit3 } from 'lucide-react';
import { AmbientEventRecord, RBACRole } from '../types/monopulse.ts';
import { SlackWorkspaceSimulator } from './SlackWorkspaceSimulator.tsx';

interface AmbientPanelProps {
  events: AmbientEventRecord[];
  selectedEventId: string;
  onSelectEventId: (id: string) => void;
  callerRole: RBACRole;
  onChangeCallerRole?: (role: RBACRole) => void;
  onRefreshSystemState?: () => Promise<void>;
  ingestingWebhook: boolean;
  runningKaggleJob: boolean;
  onEmitWebhook: (params: {
    source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
    service: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
    summary: string;
  }) => Promise<void>;
  onApproveEvent: (
    event: AmbientEventRecord,
    editedList?: { id: string; args: Record<string, any> }[]
  ) => Promise<{ type: 'success' | 'error'; message: string }>;
  onDistillEvent: (eventId: string) => Promise<void>;
}

export function AmbientPanel({
  events, selectedEventId, onSelectEventId, callerRole, onChangeCallerRole, onRefreshSystemState, ingestingWebhook, runningKaggleJob, onEmitWebhook, onApproveEvent, onDistillEvent
}: AmbientPanelProps) {
  const [webhookService, setWebhookService] = useState<'checkout-ledger-svc' | 'webhook-dispatcher-v2'>('checkout-ledger-svc');
  const [webhookSource, setWebhookSource] = useState<'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert'>('slack.incident.webhook');
  const [webhookSummary, setWebhookSummary] = useState<string>('[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.');
  const [editingMutations, setEditingMutations] = useState<Record<string, string>>({});
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [approvalFeedback, setApprovalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showLegacyComparison, setShowLegacyComparison] = useState(false);

  const selectedEvent = events.find((e) => e.eventId === selectedEventId) || events[0];

  const handleConfirmApproval = async () => {
    if (!selectedEvent) return;
    setApprovalFeedback(null);
    const editedList: { id: string; args: Record<string, any> }[] = [];
    if (isEditingBlock) {
      for (const mut of selectedEvent.stagedMutations) {
        const raw = editingMutations[mut.id];
        if (raw) {
          try {
            editedList.push({ id: mut.id, args: JSON.parse(raw) });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid JSON';
            setApprovalFeedback({ type: 'error', message: `Invalid JSON in edited parameters for ${mut.toolName}: ${msg}` });
            return;
          }
        }
      }
    }
    const res = await onApproveEvent(selectedEvent, editedList.length > 0 ? editedList : undefined);
    if (res.type === 'success') setIsEditingBlock(false);
    setApprovalFeedback(res);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F9FAFB] font-display">01. Ambient Event-Driven Pre-Computation &amp; 1-Click Approval Bus</h1>
          <p className="text-xs text-[#9CA3AF] mt-1">Re-architected from a 45-second synchronous chatbot into a silent webhook pre-computation pipeline that posts a single 1-Click Approve/Edit block.</p>
        </div>
        <button
          onClick={() => setShowLegacyComparison(!showLegacyComparison)}
          className="px-3.5 py-2 text-xs font-medium border border-[#1F2937] bg-[#111827] text-[#F9FAFB] rounded-md hover:border-slate-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {showLegacyComparison ? 'Hide Legacy Sync Chat War Story' : 'Compare Legacy Sync Chat (72% Drop-off) vs Ambient'}
        </button>
      </div>

      {showLegacyComparison && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 border border-[#1F2937] bg-[#111827] p-5 rounded-lg">
          <div className="border border-[#1F2937] bg-[#0B0F17] p-4 rounded-md space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#DC2626] font-semibold">LEGACY V1: SYNCHRONOUS CHATBOT LOOP (ABANDONED)</span>
              <span className="tabular-nums text-[#9CA3AF]">46.4s Wait · 72% Abandonment</span>
            </div>
            <div className="space-y-2 text-xs font-mono text-[#9CA3AF]">
              <div className="p-2 bg-[#111827] rounded">[00.0s] On-Call Engineer: &quot;checkout-ledger-svc is throwing 503s, what happened?&quot;</div>
              <div className="p-2 bg-[#111827] rounded text-[#D97706]">[14.2s] Legacy Bot: &quot;Which cloud region and environment should I check? Also please provide the Jira key.&quot;</div>
              <div className="p-2 bg-[#111827] rounded">[24.0s] On-Call Engineer: &quot;us-east-1 prod, OPS-4821. Just check the latest deploy!&quot;</div>
              <div className="p-2 bg-[#111827] rounded text-[#D97706]">[46.4s] Legacy Bot: &quot;Ran 8 unguided schema &amp; log queries. Would you like me to check GitHub PR #1842 next?&quot;</div>
            </div>
          </div>
          <div className="border border-[#1F2937] bg-[#0B0F17] p-4 rounded-md space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#16A34A] font-semibold">MONOPULSE V2: AMBIENT EVENT PRE-COMPUTATION</span>
              <span className="tabular-nums text-[#9CA3AF]">0.4s Perceived · 84% Retention</span>
            </div>
            <div className="space-y-2 text-xs font-mono text-[#9CA3AF]">
              <div className="p-2 bg-[#111827] rounded">[T+0.0s] PagerDuty / Slack Webhook fires on #inc-prod-alerts (OPS-4821).</div>
              <div className="p-2 bg-[#111827] rounded text-[#F9FAFB]">[T+0.1s] Tier-2 pgvector matches Playbook PB-LEDGER-CANARY-01 (-37.5% steps).</div>
              <div className="p-2 bg-[#111827] rounded text-[#F9FAFB]">[T+1.4s] Background worker runs deterministic read-only MCP tools (SQL + GitHub Diff).</div>
              <div className="p-2 bg-[#111827] rounded text-[#16A34A]">[T+1.6s] Posts 1-Click Approve/Edit Summary Block in Slack before engineer opens thread.</div>
            </div>
          </div>
        </div>
      )}

      <SlackWorkspaceSimulator
        callerRole={callerRole}
        onChangeCallerRole={onChangeCallerRole}
        onRefreshSystemState={onRefreshSystemState || (async () => {})}
      />

      <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F9FAFB]">Simulate Incoming Organizational Event Webhook</h2>
          <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
            <span>Preset Triggers:</span>
            <button onClick={() => { setWebhookService('checkout-ledger-svc'); setWebhookSource('slack.incident.webhook'); setWebhookSummary('[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'); }} className="underline hover:text-[#F9FAFB] cursor-pointer">P0 Ledger Canary Lock</button>
            <span>·</span>
            <button onClick={() => { setWebhookService('webhook-dispatcher-v2'); setWebhookSource('jira.issue.created'); setWebhookSummary('Jira OPS-4819 created: Cross-region EU webhook TLS handshake ETIMEDOUT after PR #1835 reduced timeout to 400ms.'); }} className="underline hover:text-[#F9FAFB] cursor-pointer">P1 EU Webhook TLS Timeout</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs text-[#9CA3AF] mb-1">Event Source</label>
            <select
              value={webhookSource}
              onChange={(e) => setWebhookSource(e.target.value as any)}
              className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs font-mono text-[#F9FAFB]"
            >
              <option value="slack.incident.webhook">slack.incident.webhook</option>
              <option value="jira.issue.created">jira.issue.created</option>
              <option value="github.canary.alert">github.canary.alert</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs text-[#9CA3AF] mb-1">Target Microservice</label>
            <select
              value={webhookService}
              onChange={(e) => setWebhookService(e.target.value as any)}
              className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs font-mono text-[#F9FAFB]"
            >
              <option value="checkout-ledger-svc">checkout-ledger-svc</option>
              <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs text-[#9CA3AF] mb-1">Webhook Event Payload</label>
            <input
              type="text"
              value={webhookSummary}
              onChange={(e) => setWebhookSummary(e.target.value)}
              className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              onClick={() => onEmitWebhook({ source: webhookSource, service: webhookService, summary: webhookSummary })}
              disabled={ingestingWebhook}
              className="w-full px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {ingestingWebhook ? 'Running...' : 'Ingest & Pre-Compute'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 space-y-3">
          <div className="text-xs font-semibold text-[#9CA3AF]">Ambient Pre-Computed Event Queue ({events.length})</div>
          {events.map((evt) => {
            const isSelected = evt.eventId === selectedEvent?.eventId;
            return (
              <div
                key={evt.eventId}
                onClick={() => {
                  onSelectEventId(evt.eventId);
                  setIsEditingBlock(false);
                  setApprovalFeedback(null);
                }}
                className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                  isSelected ? 'bg-[#111827] border-[#2563EB]' : 'bg-[#0E131F] border-[#1F2937] hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]">
                  <span className="text-[#F9FAFB] font-semibold">{evt.eventId}</span>
                  <span>
                    {evt.approvalState === 'STAGED_1CLICK_READY' ? (
                      <span className="text-[#D97706]">1-CLICK READY</span>
                    ) : (
                      <span className="text-[#16A34A]">{evt.approvalState}</span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 text-xs font-medium text-[#F9FAFB]">{evt.service} · {evt.channelOrTicket}</div>
                <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-2">{evt.incomingPayloadSummary}</p>
                <div className="mt-2.5 pt-2 border-t border-[#1F2937] flex items-center justify-between text-[11px] font-mono text-[#9CA3AF] tabular-nums">
                  <span>Playbook: {evt.matchedPlaybook?.id || 'NONE'}</span>
                  <span>Precompute: {evt.precomputeLatencyMs}ms</span>
                </div>
              </div>
            );
          })}
        </div>

        {selectedEvent && (
          <div className="xl:col-span-8 border border-[#1F2937] bg-[#111827] rounded-lg p-6 space-y-6">
            <div className="border-b border-[#1F2937] pb-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#9CA3AF]">
                <div>
                  <span className="text-[#F9FAFB] font-semibold">{selectedEvent.eventId}</span>
                  <span className="mx-2">·</span>
                  <span>{selectedEvent.source}</span>
                  <span className="mx-2">·</span>
                  <span>{selectedEvent.channelOrTicket}</span>
                </div>
                <div className="tabular-nums">Background Precompute: {selectedEvent.precomputeLatencyMs}ms · Perceived User Wait: 0ms</div>
              </div>
              <h3 className="text-base font-bold text-[#F9FAFB]">{selectedEvent.incomingPayloadSummary}</h3>
            </div>

            {selectedEvent.matchedPlaybook && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#F9FAFB]">Step 1 · Tier-2 pgvector Playbook Match &amp; System Prompt Injection</span>
                  <span className="font-mono tabular-nums text-[#16A34A]">
                    Cosine Similarity: {selectedEvent.matchedPlaybook.cosineSimilarity} · Step Reduction: -{selectedEvent.matchedPlaybook.stepReductionPct}%
                  </span>
                </div>
                <pre className="p-3.5 rounded-md bg-[#0B0F17] border border-[#1F2937] text-xs font-mono text-[#9CA3AF] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {selectedEvent.injectedSystemPrompt}
                </pre>
              </div>
            )}

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F9FAFB]">Step 2 · Autonomous Background Read-Only MCP Tool Trace ({selectedEvent.autonomousReadOnlyTrace.length} calls)</span>
                <span className="font-mono text-[#9CA3AF]">Zero mutations permitted during pre-computation</span>
              </div>
              <div className="border border-[#1F2937] rounded-md divide-y divide-[#1F2937] bg-[#0B0F17]">
                {selectedEvent.autonomousReadOnlyTrace.map((t) => (
                  <div key={t.step} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between font-mono">
                      <div>
                        <span className="text-[#9CA3AF]">#{t.step}</span>
                        <span className="mx-2 text-[#2563EB] font-semibold">{t.toolName}</span>
                        <span className="text-[#9CA3AF]">({t.serverId})</span>
                      </div>
                      <span className="tabular-nums text-[#9CA3AF]">{t.latencyMs}ms</span>
                    </div>
                    <div className="font-mono text-[11px] text-[#9CA3AF] truncate">args: {JSON.stringify(t.args)}</div>
                    <div className="text-[#F9FAFB] pt-0.5">{t.findingSummary}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-[#2563EB]/60 bg-[#0B0F17] rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
                <div>
                  <div className="text-xs font-mono text-[#2563EB] font-semibold">SLACK / JIRA AMBIENT BLOCK · 1-CLICK APPROVE / EDIT</div>
                  <div className="text-xs text-[#9CA3AF] mt-0.5">
                    Signed Approval Token: <code className="font-mono text-[#F9FAFB]">{selectedEvent.approvalToken}</code> · Active Caller Role: <code className="font-mono text-[#F9FAFB]">{callerRole}</code>
                  </div>
                </div>
                <div className="text-xs font-mono">
                  {selectedEvent.approvalState === 'STAGED_1CLICK_READY' ? (
                    <span className="text-[#D97706]">AWAITING 1-CLICK SIGN-OFF</span>
                  ) : (
                    <span className="text-[#16A34A]">{selectedEvent.approvalState} BY {selectedEvent.approvedByRole?.toUpperCase()}</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-[#F9FAFB] leading-relaxed bg-[#111827] p-3.5 rounded border border-[#1F2937]">
                <span className="font-semibold text-[#9CA3AF] block mb-1">Pre-Computed Root Cause Synthesis:</span>
                {selectedEvent.rootCauseSynthesis}
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-[#9CA3AF]">Staged MCP Write Mutations ({selectedEvent.stagedMutations.length})</div>
                {selectedEvent.stagedMutations.map((mut) => (
                  <div key={mut.id} className="p-3 rounded border border-[#1F2937] bg-[#111827] space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                      <div>
                        <span className="text-[#F9FAFB] font-semibold">{mut.toolName}</span>
                        <span className="mx-1.5 text-[#9CA3AF]">·</span>
                        <span className="text-[#9CA3AF]">{mut.serverId}</span>
                        <span className="mx-1.5 text-[#9CA3AF]">·</span>
                        <span className="text-[#D97706]">Requires: {mut.requiredRole}+</span>
                      </div>
                      <span className={mut.status === 'EXECUTED' ? 'text-[#16A34A]' : mut.status === 'FAILED' ? 'text-[#DC2626]' : 'text-[#9CA3AF]'}>
                        {mut.status}
                      </span>
                    </div>
                    <div className="text-[#9CA3AF]">{mut.description}</div>

                    {isEditingBlock ? (
                      <div>
                        <label className="block text-[11px] font-mono text-[#9CA3AF] mb-1">Edit JSON Arguments for {mut.toolName}:</label>
                        <textarea
                          rows={3}
                          value={editingMutations[mut.id] ?? JSON.stringify(mut.args, null, 2)}
                          onChange={(e) => setEditingMutations((prev) => ({ ...prev, [mut.id]: e.target.value }))}
                          className="w-full bg-[#0B0F17] border border-[#2563EB] rounded p-2 font-mono text-xs text-[#F9FAFB]"
                        />
                      </div>
                    ) : (
                      <pre className="p-2 bg-[#0B0F17] rounded text-[11px] font-mono text-[#9CA3AF] overflow-x-auto">
                        {JSON.stringify(mut.args, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              {approvalFeedback && (
                <div className={`p-3 rounded border text-xs font-mono ${approvalFeedback.type === 'success' ? 'border-[#16A34A] bg-[#16A34A]/10 text-[#F9FAFB]' : 'border-[#DC2626] bg-[#DC2626]/10 text-[#F9FAFB]'}`}>
                  {approvalFeedback.message}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleConfirmApproval}
                    className="px-4 py-2 bg-[#16A34A] hover:bg-green-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isEditingBlock ? 'Approve & Execute Edited Block' : '1-Click Approve & Execute'}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (!isEditingBlock) {
                        const initMap: Record<string, string> = {};
                        selectedEvent.stagedMutations.forEach((m) => {
                          initMap[m.id] = JSON.stringify(m.args, null, 2);
                        });
                        setEditingMutations(initMap);
                      }
                      setIsEditingBlock(!isEditingBlock);
                    }}
                    className="px-3.5 py-2 border border-[#1F2937] bg-[#111827] hover:border-slate-600 text-xs font-medium text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingBlock ? 'Cancel Edit' : 'Edit Staged Parameters'}</span>
                  </button>
                </div>

                <button
                  onClick={() => onDistillEvent(selectedEvent.eventId)}
                  disabled={runningKaggleJob}
                  className="px-3.5 py-2 border border-[#1F2937] bg-[#111827] hover:border-[#2563EB] text-xs font-medium text-[#9CA3AF] hover:text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Cpu className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>{runningKaggleJob ? 'Distilling on Kaggle GPU...' : 'Distill Trajectory to Playbook (Kaggle GPU)'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
