import React, { useState } from 'react';
import { Check, Cpu, Edit3, Search, ShieldCheck } from 'lucide-react';
import { AmbientEventRecord, RBACRole } from '../types/monopulse.ts';

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'executed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingMutations, setEditingMutations] = useState<Record<string, string>>({});
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [approvalFeedback, setApprovalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [quorumOperator, setQuorumOperator] = useState<string>('ravi.kishore');
  const [quorumState, setQuorumState] = useState<{
    signaturesCollected: number;
    requiredSignatures: number;
    quorumMet: boolean;
    signers: string[];
  } | null>(null);

  const filteredEvents = events.filter((evt) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'pending' && evt.approvalState === 'STAGED_1CLICK_READY') ||
      (statusFilter === 'executed' && evt.approvalState !== 'STAGED_1CLICK_READY');
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      evt.eventId.toLowerCase().includes(q) ||
      evt.service.toLowerCase().includes(q) ||
      evt.channelOrTicket.toLowerCase().includes(q) ||
      evt.incomingPayloadSummary.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const selectedEvent =
    filteredEvents.find((e) => e.eventId === selectedEventId) ||
    events.find((e) => e.eventId === selectedEventId) ||
    events[0];

  const handleSignQuorum = async (operatorId: string) => {
    if (!selectedEvent) return;
    const res = await fetch(`/api/events/${selectedEvent.eventId}/quorum-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, callerRole })
    });
    const data = await res.json();
    setQuorumState(data);
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
            setApprovalFeedback({
              type: 'error',
              message: `Invalid JSON in edited parameters for ${mut.toolName}: ${msg}`
            });
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
          <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
            Incident Triage &amp; Remediation Queue
          </h1>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Review automated read-only diagnostic traces, verify root-cause findings, and authorize staged production remediations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search service or ticket..."
              className="bg-[#111827] border border-[#1F2937] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#F9FAFB] w-52"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg">
            {(['all', 'pending', 'executed'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                {st === 'all' ? 'All' : st === 'pending' ? 'Pending Approval' : 'Executed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF]">
            <span>Incident Queue ({filteredEvents.length})</span>
            <span className="font-mono tabular-nums">Role: {callerRole}</span>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="p-6 rounded-lg border border-[#1F2937] bg-[#111827] text-xs text-[#9CA3AF] text-center">
              No incidents match the current filter criteria.
            </div>
          ) : (
            filteredEvents.map((evt) => {
              const isSelected = evt.eventId === selectedEvent?.eventId;
              return (
                <div
                  key={evt.eventId}
                  onClick={() => {
                    onSelectEventId(evt.eventId);
                    setIsEditingBlock(false);
                    setApprovalFeedback(null);
                    setQuorumState(null);
                  }}
                  className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#111827] border-[#2563EB]'
                      : 'bg-[#0E131F] border-[#1F2937] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]">
                    <span className="text-[#F9FAFB] font-semibold">{evt.eventId}</span>
                    <span className={evt.approvalState === 'STAGED_1CLICK_READY' ? 'text-[#D97706]' : 'text-[#16A34A]'}>
                      {evt.approvalState === 'STAGED_1CLICK_READY' ? 'PENDING APPROVAL' : 'EXECUTED'}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-[#F9FAFB]">
                    {evt.service} · {evt.channelOrTicket}
                  </div>
                  <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-2">{evt.incomingPayloadSummary}</p>
                  <div className="mt-2.5 pt-2 border-t border-[#1F2937] flex items-center justify-between text-[11px] font-mono text-[#9CA3AF] tabular-nums">
                    <span>Runbook: {evt.matchedPlaybook?.id || 'NONE'}</span>
                    <span>Diag: {evt.precomputeLatencyMs}ms</span>
                  </div>
                </div>
              );
            })
          )}
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
                <div className="tabular-nums">Diagnostic Duration: {selectedEvent.precomputeLatencyMs}ms</div>
              </div>
              <h2 className="text-base font-bold text-[#F9FAFB]">{selectedEvent.incomingPayloadSummary}</h2>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F9FAFB]">
                  Automated Read-Only Diagnostic Trace ({selectedEvent.autonomousReadOnlyTrace.length} checks)
                </span>
                <span className="font-mono text-[#9CA3AF]">
                  Matched Runbook: {selectedEvent.matchedPlaybook?.id || 'Standard Triage'}
                </span>
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
                  <div className="text-xs font-mono text-[#2563EB] font-semibold">
                    REMEDIATION APPROVAL &amp; EXECUTION PLAN
                  </div>
                  <div className="text-xs text-[#9CA3AF] mt-0.5">
                    Approval Signature: <code className="font-mono text-[#F9FAFB]">{selectedEvent.approvalToken}</code> · Role: <code className="font-mono text-[#F9FAFB]">{callerRole}</code>
                  </div>
                </div>
                <div className="text-xs font-mono">
                  {selectedEvent.approvalState === 'STAGED_1CLICK_READY' ? (
                    <span className="text-[#D97706]">AWAITING SIGN-OFF</span>
                  ) : (
                    <span className="text-[#16A34A]">{selectedEvent.approvalState} BY {selectedEvent.approvedByRole?.toUpperCase()}</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-[#F9FAFB] leading-relaxed bg-[#111827] p-3.5 rounded border border-[#1F2937]">
                <span className="font-semibold text-[#9CA3AF] block mb-1">Root Cause Synthesis:</span>
                {selectedEvent.rootCauseSynthesis}
              </div>

              <div className="p-3 rounded border border-[#1F2937] bg-[#111827] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
                  <div>
                    <span className="font-semibold text-[#F9FAFB]">Two-Person Production Quorum (M-of-N = 2/2)</span>
                    <div className="text-[11px] font-mono text-[#9CA3AF]">
                      {quorumState
                        ? `Signers: ${quorumState.signers.join(', ') || 'none'} (${quorumState.signaturesCollected}/${quorumState.requiredSignatures}) · ${quorumState.quorumMet ? 'QUORUM MET' : 'AWAITING 2ND SIGNER'}`
                        : 'Co-sign as two distinct operators before executing high-blast-radius rollbacks'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={quorumOperator}
                    onChange={(e) => setQuorumOperator(e.target.value)}
                    className="bg-[#0B0F17] border border-[#1F2937] rounded px-2.5 py-1 text-xs font-mono text-[#F9FAFB]"
                  >
                    <option value="ravi.kishore">@ravi.kishore (SRE)</option>
                    <option value="sre_oncall_dana">@sre_oncall_dana (SRE)</option>
                    <option value="mchen">@mchen (Eng Lead)</option>
                  </select>
                  <button
                    onClick={() => handleSignQuorum(quorumOperator)}
                    className="px-3 py-1 bg-[#1F2937] hover:bg-slate-700 text-[#F9FAFB] text-xs font-mono rounded cursor-pointer whitespace-nowrap"
                  >
                    Sign Quorum
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-[#9CA3AF]">
                  Staged Remediation Actions ({selectedEvent.stagedMutations.length})
                </div>
                {selectedEvent.stagedMutations.map((mut) => (
                  <div key={mut.id} className="p-3 rounded border border-[#1F2937] bg-[#111827] space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                      <div>
                        <span className="text-[#F9FAFB] font-semibold">{mut.toolName}</span>
                        <span className="mx-1.5 text-[#9CA3AF]">·</span>
                        <span className="text-[#9CA3AF]">{mut.serverId}</span>
                        <span className="mx-1.5 text-[#9CA3AF]">·</span>
                        <span className="text-[#D97706]">Role: {mut.requiredRole}+</span>
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
                    <span>{isEditingBlock ? 'Approve & Execute Edited Actions' : 'Approve & Execute Remediation'}</span>
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
                    <span>{isEditingBlock ? 'Cancel Edit' : 'Edit Parameters'}</span>
                  </button>
                </div>

                <button
                  onClick={() => onDistillEvent(selectedEvent.eventId)}
                  disabled={runningKaggleJob}
                  className="px-3.5 py-2 border border-[#1F2937] bg-[#111827] hover:border-[#2563EB] text-xs font-medium text-[#9CA3AF] hover:text-[#F9FAFB] rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
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
