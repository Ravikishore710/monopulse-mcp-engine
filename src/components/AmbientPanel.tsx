import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Cpu, Edit3, Search, ShieldCheck } from 'lucide-react';
import { AmbientEventRecord, RBACRole } from '../types/monopulse.ts';
import { useApiAction } from '../hooks/useApiAction.ts';
import { THEME } from '../theme.ts';

interface AmbientPanelProps {
  events: AmbientEventRecord[];
  selectedEventId: string;
  onSelectEventId: (id: string) => void;
  callerRole: RBACRole;
  onChangeCallerRole?: (role: RBACRole) => void;
  onRefreshSystemState?: () => Promise<void>;
  ingestingWebhook?: boolean;
  runningKaggleJob: boolean;
  onEmitWebhook?: (params: {
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

function parseIncidentSummary(raw: string) {
  const bracketMatch = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  const badge = bracketMatch ? bracketMatch[1] : 'INCIDENT';
  const body = bracketMatch ? bracketMatch[2] : raw;
  const parts = body.split(/;\s*/);
  return { badge, headline: parts[0] || body, subline: parts.slice(1).join(' · ') };
}

export function AmbientPanel({
  events,
  selectedEventId,
  onSelectEventId,
  callerRole,
  onRefreshSystemState,
  runningKaggleJob,
  onApproveEvent,
  onDistillEvent
}: AmbientPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'resolved'>('all');
  const [inProgressIds, setInProgressIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFullTrace, setShowFullTrace] = useState<boolean>(false);
  const [expandedMutationIds, setExpandedMutationIds] = useState<Record<string, boolean>>({});
  const [editingMutations, setEditingMutations] = useState<Record<string, string>>({});
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [approvalFeedback, setApprovalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [quorumOperator, setQuorumOperator] = useState<string>('ravi.kishore');
  const { data: quorumState, setData: setQuorumState, runAction: runQuorumSign } = useApiAction<{
    signaturesCollected: number;
    requiredSignatures: number;
    quorumMet: boolean;
    signers: string[];
  }>();

  const getIncidentCategory = (evt: AmbientEventRecord): 'Pending' | 'In-Progress' | 'Resolved' => {
    if (evt.approvalState === 'APPROVED_AND_EXECUTED' || evt.approvalState === 'EDITED_AND_EXECUTED' || evt.status === 'REMEDIATION_EXECUTED') {
      return 'Resolved';
    }
    if (inProgressIds[evt.eventId] || evt.approvalState === 'IN_PROGRESS' || evt.status === 'PRECOMPUTING_CONTEXT' || evt.stagedMutations.some((m) => m.status === 'EXECUTED')) {
      return 'In-Progress';
    }
    return 'Pending';
  };

  const filteredEvents = events.filter((evt) => {
    const category = getIncidentCategory(evt);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && category === 'Pending') ||
      (statusFilter === 'in_progress' && category === 'In-Progress') ||
      (statusFilter === 'resolved' && category === 'Resolved');
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      evt.eventId.toLowerCase().includes(q) ||
      evt.service.toLowerCase().includes(q) ||
      evt.channelOrTicket.toLowerCase().includes(q) ||
      evt.incomingPayloadSummary.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const selectedEvent = filteredEvents.find((e) => e.eventId === selectedEventId) || events.find((e) => e.eventId === selectedEventId) || events[0];

  const handleSignQuorum = async (operatorId: string) => {
    if (!selectedEvent) return;
    setInProgressIds((prev) => ({ ...prev, [selectedEvent.eventId]: true }));
    await runQuorumSign(`/api/events/${selectedEvent.eventId}/quorum-sign`, {
      method: 'POST',
      body: { operatorId, callerRole }
    });
    if (onRefreshSystemState) await onRefreshSystemState();
  };

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

  const parsedSelected = selectedEvent ? parseIncidentSummary(selectedEvent.incomingPayloadSummary) : null;

  return (
    <div className="space-y-6">
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${THEME.HEADER_BORDER}`}>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#F9FAFB] font-display">Incident Triage &amp; Remediation Queue</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            Executive root-cause summaries with on-demand diagnostic traces and 1-Click remediation sign-off.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-2.5" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search service or ticket..." className="bg-[#111827] border border-[#1F2937] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#F9FAFB] w-48" />
          </div>
          <select aria-label="Incident Status Filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pending' | 'in_progress' | 'resolved')} className="bg-[#111827] border border-[#1F2937] rounded-md px-2.5 py-1.5 text-xs font-medium text-[#F9FAFB] cursor-pointer">
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In-Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <div className={`flex items-center gap-1 p-1 ${THEME.SURFACE_CARD}`}>
            {([
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending' },
              { id: 'in_progress', label: 'In-Progress' },
              { id: 'resolved', label: 'Resolved' }
            ] as const).map((st) => (
              <button key={st.id} onClick={() => setStatusFilter(st.id)} className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${statusFilter === st.id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-[#9CA3AF]">
            <span>Incident Queue ({filteredEvents.length})</span>
            <span className="font-mono text-[11px] tabular-nums">Role: {callerRole}</span>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="p-6 rounded-xl border border-[#1F2937] bg-[#111827] text-xs text-[#9CA3AF] text-center">No incidents match the current filter criteria.</div>
          ) : (
            filteredEvents.map((evt) => {
              const isSelected = evt.eventId === selectedEvent?.eventId;
              const category = getIncidentCategory(evt);
              const parsed = parseIncidentSummary(evt.incomingPayloadSummary);
              return (
                <div
                  key={evt.eventId}
                  onClick={() => { onSelectEventId(evt.eventId); setIsEditingBlock(false); setApprovalFeedback(null); setQuorumState(null); }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-[#111827] border-[#2563EB] border-l-4 border-l-[#2563EB]' : 'bg-[#0E131F] border-[#1F2937] hover:border-slate-700'}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#F9FAFB] font-medium">{evt.service}</span>
                    <span className={`font-mono text-[11px] font-medium ${category === 'Pending' ? 'text-[#D97706]' : category === 'In-Progress' ? 'text-[#2563EB]' : 'text-[#16A34A]'}`}>{category.toUpperCase()}</span>
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-[#F9FAFB]/95 leading-snug">{parsed.headline}</div>
                  {parsed.subline && <div className="mt-0.5 text-[11px] text-[#9CA3AF] line-clamp-1">{parsed.subline}</div>}
                  <div className="mt-3 pt-2.5 border-t border-[#1F2937]/80 flex items-center justify-between text-[11px] text-[#9CA3AF]">
                    <span className="font-mono">{evt.eventId} · {evt.channelOrTicket}</span>
                    <span className="font-mono tabular-nums">{evt.precomputeLatencyMs}ms</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {selectedEvent && parsedSelected && (
          <div className="xl:col-span-8 border border-[#1F2937] bg-[#111827] rounded-xl overflow-hidden divide-y divide-[#1F2937]">
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-[#9CA3AF] font-mono">
                  <span className="text-[#D97706] font-medium">{parsedSelected.badge}</span>
                  <span>·</span>
                  <span className="text-[#F9FAFB] font-medium">{selectedEvent.eventId}</span>
                  <span>·</span>
                  <span>{selectedEvent.service}</span>
                  <span>·</span>
                  <span>{selectedEvent.channelOrTicket}</span>
                </div>
                <div className="font-mono text-xs">
                  {selectedEvent.approvalState === 'STAGED_1CLICK_READY' ? (
                    <span className="text-[#D97706] font-medium">AWAITING SIGN-OFF</span>
                  ) : (
                    <span className="text-[#16A34A] font-medium">{selectedEvent.approvalState} BY {selectedEvent.approvedByRole?.toUpperCase()}</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <h2 className="text-base font-semibold tracking-tight text-[#F9FAFB] leading-snug">{parsedSelected.headline}</h2>
                {parsedSelected.subline && <p className="text-xs text-[#9CA3AF] leading-relaxed">{parsedSelected.subline}</p>}
              </div>

              <div className="p-4 rounded-lg bg-[#0E131F] border border-[#1F2937] border-l-2 border-l-[#2563EB] space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[#2563EB]">Executive Summary &amp; Root Cause Synthesis</div>
                <p className="text-xs text-[#F9FAFB]/90 leading-relaxed">{selectedEvent.rootCauseSynthesis}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                <div className="p-3 rounded-lg bg-[#0B0F17] border border-[#1F2937]">
                  <span className="text-[11px] text-[#9CA3AF] block">Diagnostic Checks</span>
                  <span className="font-mono text-xs text-[#F9FAFB] font-medium mt-0.5 block">{selectedEvent.autonomousReadOnlyTrace.length} verified · {selectedEvent.precomputeLatencyMs}ms</span>
                </div>
                <div className="p-3 rounded-lg bg-[#0B0F17] border border-[#1F2937]">
                  <span className="text-[11px] text-[#9CA3AF] block">Matched Runbook</span>
                  <span className="font-mono text-xs text-[#F9FAFB] font-medium mt-0.5 block">{selectedEvent.matchedPlaybook?.id || 'Standard Triage'}</span>
                </div>
                <div className="p-3 rounded-lg bg-[#0B0F17] border border-[#1F2937]">
                  <span className="text-[11px] text-[#9CA3AF] block">Approval Signature</span>
                  <span className="font-mono text-xs text-[#9CA3AF] truncate mt-0.5 block" title={selectedEvent.approvalToken}>{selectedEvent.approvalToken}</span>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-3 bg-[#0E131F]/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#F9FAFB]">Automated Read-Only Diagnostic Trace ({selectedEvent.autonomousReadOnlyTrace.length} checks)</div>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">{selectedEvent.autonomousReadOnlyTrace[selectedEvent.autonomousReadOnlyTrace.length - 1]?.findingSummary || 'All read-only diagnostic probes completed without production side effects.'}</p>
                </div>
                <button type="button" onClick={() => setShowFullTrace((prev) => !prev)} className="px-3 py-1.5 text-xs font-medium border border-[#1F2937] bg-[#111827] hover:border-slate-600 text-[#F9FAFB] rounded-md flex items-center gap-1.5 cursor-pointer">
                  <span>{showFullTrace ? 'Hide Full Overview' : 'View Full Diagnostic Overview'}</span>
                  {showFullTrace ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {showFullTrace ? (
                <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-lg bg-[#0B0F17]">
                  {selectedEvent.autonomousReadOnlyTrace.map((t) => (
                    <div key={t.step} className="p-3.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><span className="font-mono text-[#9CA3AF]">#{t.step}</span><span className="font-mono text-[#2563EB] font-medium">{t.toolName}</span><span className="text-[#9CA3AF]">({t.serverId})</span></div>
                        <span className="font-mono tabular-nums text-[#9CA3AF]">{t.latencyMs}ms</span>
                      </div>
                      <p className="text-[#F9FAFB]/90 leading-relaxed">{t.findingSummary}</p>
                      <div className="font-mono text-[11px] text-[#9CA3AF] bg-[#111827] px-2.5 py-1.5 rounded border border-[#1F2937]/70 overflow-x-auto">{JSON.stringify(t.args)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                  {selectedEvent.autonomousReadOnlyTrace.map((t) => (
                    <div key={t.step} className="px-3.5 py-2.5 rounded-lg border border-[#1F2937] bg-[#0B0F17] flex items-start justify-between gap-2 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-mono text-[11px] text-[#2563EB] font-medium truncate">#{t.step} · {t.toolName}</div>
                        <div className="text-[#F9FAFB]/90 line-clamp-1">{t.findingSummary}</div>
                      </div>
                      <span className="font-mono text-[11px] text-[#9CA3AF] tabular-nums shrink-0">{t.latencyMs}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold text-[#F9FAFB]">Staged Remediation Actions ({selectedEvent.stagedMutations.length})</h3>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">Summary of production changes staged for execution upon operator sign-off.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-[#0B0F17] border border-[#1F2937] px-3 py-2 rounded-lg text-xs">
                  <ShieldCheck className="w-4 h-4 text-[#2563EB] shrink-0" />
                  <span className="text-[#9CA3AF] font-medium">
                    {quorumState ? `Quorum (${quorumState.signaturesCollected}/${quorumState.requiredSignatures}) · ${quorumState.quorumMet ? 'QUORUM MET' : 'AWAITING 2ND SIGNER'}` : 'Two-Person Quorum (2/2)'}
                  </span>
                  <select value={quorumOperator} onChange={(e) => setQuorumOperator(e.target.value)} className="bg-[#111827] border border-[#1F2937] rounded px-2 py-1 text-xs font-mono text-[#F9FAFB]">
                    <option value="ravi.kishore">@ravi.kishore (SRE)</option>
                    <option value="sre_oncall_dana">@sre_oncall_dana (SRE)</option>
                    <option value="mchen">@mchen (Eng Lead)</option>
                  </select>
                  <button onClick={() => handleSignQuorum(quorumOperator)} className="px-2.5 py-1 bg-[#1F2937] hover:bg-slate-700 text-[#F9FAFB] text-xs font-mono rounded cursor-pointer whitespace-nowrap">Sign Quorum</button>
                </div>
              </div>

              <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-lg bg-[#0B0F17]">
                {selectedEvent.stagedMutations.map((mut, idx) => {
                  const isPayloadOpen = Boolean(expandedMutationIds[mut.id]);
                  return (
                    <div key={mut.id} className="p-4 space-y-2 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-[#F9FAFB]">{idx + 1}. {mut.description}</div>
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#9CA3AF]">
                            <span className="text-[#2563EB]">{mut.toolName}</span><span>·</span><span>{mut.serverId}</span><span>·</span><span className="text-[#D97706]">Role: {mut.requiredRole}+</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5">
                          {!isEditingBlock && (
                            <button type="button" onClick={() => setExpandedMutationIds((prev) => ({ ...prev, [mut.id]: !prev[mut.id] }))} className="text-[11px] font-mono text-[#9CA3AF] hover:text-[#F9FAFB] underline cursor-pointer">
                              {isPayloadOpen ? 'Hide Payload' : 'View Payload'}
                            </button>
                          )}
                          <span className={`font-mono text-[11px] font-medium ${mut.status === 'EXECUTED' ? 'text-[#16A34A]' : mut.status === 'FAILED' ? 'text-[#DC2626]' : 'text-[#9CA3AF]'}`}>{mut.status}</span>
                        </div>
                      </div>
                      {isEditingBlock ? (
                        <div className="pt-1">
                          <label className="block text-[11px] font-mono text-[#9CA3AF] mb-1">Edit JSON Arguments for {mut.toolName}:</label>
                          <textarea rows={3} value={editingMutations[mut.id] ?? JSON.stringify(mut.args, null, 2)} onChange={(e) => setEditingMutations((prev) => ({ ...prev, [mut.id]: e.target.value }))} className="w-full bg-[#111827] border border-[#2563EB] rounded p-2.5 font-mono text-xs text-[#F9FAFB]" />
                        </div>
                      ) : isPayloadOpen ? (
                        <pre className="p-2.5 bg-[#111827] border border-[#1F2937] rounded text-[11px] font-mono text-[#9CA3AF] overflow-x-auto">{JSON.stringify(mut.args, null, 2)}</pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {approvalFeedback && (
                <div className={`p-3 rounded border text-xs font-mono ${approvalFeedback.type === 'success' ? 'border-[#16A34A] bg-[#16A34A]/10 text-[#F9FAFB]' : 'border-[#DC2626] bg-[#DC2626]/10 text-[#F9FAFB]'}`}>{approvalFeedback.message}</div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button onClick={handleConfirmApproval} className="px-4 py-2 bg-[#16A34A] hover:bg-green-500 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap">
                    <Check className="w-4 h-4" />
                    <span>{isEditingBlock ? 'Approve & Execute Edited Actions' : 'Approve & Execute Remediation'}</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!isEditingBlock) {
                        const initMap: Record<string, string> = {};
                        selectedEvent.stagedMutations.forEach((m) => { initMap[m.id] = JSON.stringify(m.args, null, 2); });
                        setEditingMutations(initMap);
                      }
                      setIsEditingBlock(!isEditingBlock);
                    }}
                    className="px-3.5 py-2 border border-[#1F2937] bg-[#0B0F17] hover:border-slate-600 text-xs font-medium text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingBlock ? 'Cancel Edit' : 'Edit Parameters'}</span>
                  </button>
                </div>
                <button onClick={() => onDistillEvent(selectedEvent.eventId)} disabled={runningKaggleJob} className="px-3.5 py-2 border border-[#1F2937] bg-[#0B0F17] hover:border-[#2563EB] text-xs font-medium text-[#9CA3AF] hover:text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <Cpu className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>{runningKaggleJob ? 'Saving to Runbook Library...' : 'Save Trajectory as Runbook'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
