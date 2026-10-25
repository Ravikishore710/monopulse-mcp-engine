import React, { useEffect, useState } from 'react';
import { Database, Layers, ShieldAlert, Terminal } from 'lucide-react';
import {
  ActiveModule,
  AmbientEventRecord,
  RBACRole,
  SystemState
} from './types/monopulse.ts';
import { AmbientPanel } from './components/AmbientPanel.tsx';
import { McpPanel } from './components/McpPanel.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { CliPanel } from './components/CliPanel.tsx';

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState<ActiveModule>('ambient');
  const [callerRole, setCallerRole] = useState<RBACRole>('sre_admin');
  const [selectedEventId, setSelectedEventId] = useState<string>('evt-ambient-901');
  const [selectedServerFilter, setSelectedServerFilter] = useState<string>('all');
  const [ingestingWebhook, setIngestingWebhook] = useState(false);
  const [runningKaggleJob, setRunningKaggleJob] = useState(false);

  const fetchSystemState = async () => {
    try {
      const res = await fetch('/api/system/state');
      const data: SystemState = await res.json();
      setState(data);
      if (
        data.ambientEvents.length > 0 &&
        !data.ambientEvents.some((e) => e.eventId === selectedEventId)
      ) {
        setSelectedEventId(data.ambientEvents[0].eventId);
      }
    } catch {
      // Handled by loading UI fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemState();
  }, []);

  const handleEmitWebhook = async (params: {
    source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
    service: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
    summary: string;
  }) => {
    setIngestingWebhook(true);
    try {
      const res = await fetch('/api/webhooks/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: params.source,
          service: params.service,
          channelOrTicket:
            params.service === 'checkout-ledger-svc'
              ? '#inc-prod-alerts · OPS-4821'
              : 'OPS-4819 · #tier2-customer-escalations',
          payloadSummary: params.summary
        })
      });
      const data = await res.json();
      await fetchSystemState();
      if (data.event?.eventId) {
        setSelectedEventId(data.event.eventId);
        setActiveModule('ambient');
      }
    } finally {
      setIngestingWebhook(false);
    }
  };

  const handleApproveEvent = async (
    event: AmbientEventRecord,
    editedList?: { id: string; args: Record<string, any> }[]
  ): Promise<{ type: 'success' | 'error'; message: string }> => {
    const res = await fetch(`/api/events/${event.eventId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerRole,
        editedMutations: editedList
      })
    });
    const data = await res.json();
    await fetchSystemState();

    if (data.success) {
      return {
        type: 'success',
        message: `1-Click Approval executed (${data.results.length} mutations verified under role '${callerRole}').`
      };
    }
    const failed = data.results?.find((r: any) => r.status !== 'SUCCESS');
    return {
      type: 'error',
      message: `MCP Boundary blocked mutation '${failed?.toolName}': ${failed?.detail?.message || 'RBAC policy denied for current role.'}`
    };
  };

  const handleDistillEvent = async (eventId: string) => {
    setRunningKaggleJob(true);
    try {
      await fetch('/api/kaggle/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId })
      });
      await fetchSystemState();
      setActiveModule('memory');
    } finally {
      setRunningKaggleJob(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex items-center justify-center p-8">
        <div className="max-w-md w-full border border-[#1F2937] bg-[#111827] p-6 rounded-lg space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]">
            <span>MONOPULSE CORE ENGINE</span>
            <span>INITIALIZING MCP BUS</span>
          </div>
          <div className="h-2 bg-[#1F2937] rounded overflow-hidden">
            <div className="h-full w-2/3 bg-[#2563EB]" />
          </div>
          <p className="text-xs text-[#9CA3AF]">
            Mounting 6 MCP servers (28 deterministic tools), Tier-1 Redis state store, Tier-2 pgvector index, and Kaggle GPU distillation bridge...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-[#1F2937] bg-[#0B0F17] sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveModule('ambient');
          }}
          className="text-lg font-bold tracking-tight text-[#F9FAFB] font-display whitespace-nowrap shrink-0"
        >
          MonoPulse
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#9CA3AF]">
          <button
            onClick={() => setActiveModule('ambient')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'ambient' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            Ambient Event Bus
          </button>
          <button
            onClick={() => setActiveModule('mcp')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'mcp' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            MCP Surface &amp; RBAC
          </button>
          <button
            onClick={() => setActiveModule('memory')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'memory' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            Memory &amp; Kaggle GPU
          </button>
          <button
            onClick={() => setActiveModule('cli')}
            className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeModule === 'cli' ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
            }`}
          >
            CLI &amp; Wire Protocol
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() =>
              handleEmitWebhook({
                source: 'slack.incident.webhook',
                service: 'checkout-ledger-svc',
                summary:
                  '[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'
              })
            }
            disabled={ingestingWebhook}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-md hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {ingestingWebhook ? 'Pre-Computing Event...' : 'Emit Incident Webhook'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[268px] shrink-0 border-r border-[#1F2937] bg-[#0E131F] p-5 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-6">
            <div>
              <div className="text-xs font-medium text-[#9CA3AF] mb-2">System Modules</div>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveModule('ambient')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'ambient'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Layers className="w-4 h-4 shrink-0" />
                    <span>01. Ambient Event Bus</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.ambientEvents.length}</span>
                </button>

                <button
                  onClick={() => setActiveModule('mcp')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'mcp'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>02. MCP Tool Boundary</span>
                  </span>
                  <span className="font-mono tabular-nums">6 / 28</span>
                </button>

                <button
                  onClick={() => setActiveModule('memory')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'memory'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Database className="w-4 h-4 shrink-0" />
                    <span>03. Memory &amp; Playbooks</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.pgvectorPlaybooks.length}</span>
                </button>

                <button
                  onClick={() => setActiveModule('cli')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeModule === 'cli'
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span>04. Live CLI &amp; Wire Log</span>
                  </span>
                  <span className="font-mono tabular-nums">{state.wireLog.length}</span>
                </button>
              </div>
            </div>

            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-xs font-medium text-[#9CA3AF] mb-1.5">
                Active Caller RBAC Token
              </div>
              <p className="text-xs text-[#9CA3AF]/80 mb-3 leading-relaxed">
                Enforced at the MCP JSON-RPC boundary before any tool handler executes.
              </p>
              <div className="space-y-1.5">
                {(
                  [
                    { role: 'sre_admin', desc: 'Full Read + Canary Rollback + Mutations' },
                    { role: 'eng_lead', desc: 'Read + PR Review & Jira RCA Writes' },
                    { role: 'support_tier2', desc: 'Read + Jira Status & Slack Broadcast' },
                    { role: 'readonly_analyst', desc: 'Strictly Read-Only Tools (0 Mutations)' }
                  ] as { role: RBACRole; desc: string }[]
                ).map((item) => (
                  <button
                    key={item.role}
                    onClick={() => setCallerRole(item.role)}
                    className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                      callerRole === item.role
                        ? 'bg-[#111827] border-[#2563EB] text-[#F9FAFB]'
                        : 'bg-[#0B0F17] border-[#1F2937] text-[#9CA3AF] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono font-semibold">
                      <span>{item.role}</span>
                      {callerRole === item.role && <span className="text-[#2563EB]">ACTIVE</span>}
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-xs font-medium text-[#9CA3AF] mb-2.5">
                Mounted MCP Servers (JSON-RPC 2.0)
              </div>
              <div className="space-y-2 text-xs">
                {state.mcpServers.map((srv) => (
                  <div
                    key={srv.id}
                    onClick={() => {
                      setSelectedServerFilter(srv.id);
                      setActiveModule('mcp');
                    }}
                    className="flex items-center justify-between text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer py-0.5"
                  >
                    <span className="font-mono truncate">{srv.id}</span>
                    <span className="font-mono tabular-nums text-[#9CA3AF]">
                      {srv.toolCount} tools
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#1F2937] text-[11px] text-[#9CA3AF] space-y-1 font-mono">
            <div>Runtime · Node.js + Express MCP</div>
            <div>Memory · pgvector + Redis TTL</div>
            <div>GPU Bridge · Kaggle NVIDIA T4x2</div>
          </div>
        </aside>

        <main id="top" className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 overflow-y-auto">
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">MCP Tool Surface &amp; Boundary</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#F9FAFB]">
                  6 Servers · 28 Tools
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Draft-07 JSON Schema · Granular RBAC Gate
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Playbook Extractor Efficiency</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#16A34A]">
                  -{state.metrics.avgStepReductionPct}% Steps
                </span>
                <span className="text-xs font-mono tabular-nums text-[#9CA3AF]">8.0 → 5.0 avg</span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                pgvector cosine injection + Kaggle GPU distillation
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Perceived Incident Triage Latency</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#F9FAFB]">
                  0.4s Ambient
                </span>
                <span className="text-xs font-mono tabular-nums text-[#D97706]">
                  vs 46.4s Sync Chat
                </span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Pre-computed on webhook arrival · 0 clarifying questions
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
              <div className="text-xs text-[#9CA3AF]">Weekly Active Operator Retention</div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-2xl font-bold font-mono tabular-nums text-[#16A34A]">
                  84.0% Retained
                </span>
                <span className="text-xs font-mono tabular-nums text-[#DC2626]">Up from 28.0%</span>
              </div>
              <div className="mt-1 text-xs text-[#9CA3AF]">
                Eliminated 72% week-one chat abandonment drop-off
              </div>
            </div>
          </section>

          {activeModule === 'ambient' && (
            <AmbientPanel
              events={state.ambientEvents}
              selectedEventId={selectedEventId}
              onSelectEventId={setSelectedEventId}
              callerRole={callerRole}
              ingestingWebhook={ingestingWebhook}
              runningKaggleJob={runningKaggleJob}
              onEmitWebhook={handleEmitWebhook}
              onApproveEvent={handleApproveEvent}
              onDistillEvent={handleDistillEvent}
            />
          )}

          {activeModule === 'mcp' && (
            <McpPanel
              servers={state.mcpServers}
              tools={state.mcpTools}
              callerRole={callerRole}
              onChangeCallerRole={setCallerRole}
              selectedServerFilter={selectedServerFilter}
              onSelectServerFilter={setSelectedServerFilter}
              onRefreshState={fetchSystemState}
            />
          )}

          {activeModule === 'memory' && (
            <MemoryPanel
              avgStepReductionPct={state.metrics.avgStepReductionPct}
              pgvectorPlaybooks={state.pgvectorPlaybooks}
              redisTier1={state.redisTier1}
              kaggleGpuJobs={state.kaggleGpuJobs}
              selectedEventId={selectedEventId}
              onRefreshState={fetchSystemState}
            />
          )}

          {activeModule === 'cli' && (
            <CliPanel
              wireLog={state.wireLog}
              callerRole={callerRole}
              onRefreshState={fetchSystemState}
            />
          )}
        </main>
      </div>
    </div>
  );
}
