import React, { useEffect, useState } from 'react';
import { Database, Layers, Lock, ShieldAlert, Terminal } from 'lucide-react';
import { ActiveModule, AmbientEventRecord, RBACRole, SystemState } from './types/monopulse.ts';
import { AmbientPanel } from './components/AmbientPanel.tsx';
import { McpPanel } from './components/McpPanel.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { CliPanel } from './components/CliPanel.tsx';
import { TrustAuditPanel } from './components/TrustAuditPanel.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';

const MODULE_TABS: { id: ActiveModule; label: string }[] = [
  { id: 'ambient', label: 'Ambient Event Bus' },
  { id: 'mcp', label: 'MCP Surface & RBAC' },
  { id: 'memory', label: 'Memory & Kaggle GPU' },
  { id: 'cli', label: 'CLI & Wire Protocol' },
  { id: 'audit', label: 'SQLite & Crypto Audit' }
];

const RBAC_ROLES_META: { role: RBACRole; desc: string }[] = [
  { role: 'sre_admin', desc: 'Full Read + Canary Rollback + Mutations' },
  { role: 'eng_lead', desc: 'Read + PR Review & Jira RCA Writes' },
  { role: 'support_tier2', desc: 'Read + Jira Status & Slack Broadcast' },
  { role: 'readonly_analyst', desc: 'Strictly Read-Only Tools (0 Mutations)' }
];

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState<ActiveModule>(() => {
    try {
      return (localStorage.getItem('monopulse_active_module') as ActiveModule) || 'ambient';
    } catch {
      return 'ambient';
    }
  });
  const [callerRole, setCallerRole] = useState<RBACRole>(() => {
    try {
      return (localStorage.getItem('monopulse_caller_role') as RBACRole) || 'sre_admin';
    } catch {
      return 'sre_admin';
    }
  });
  const [selectedEventId, setSelectedEventId] = useState<string>('evt-ambient-901');
  const [selectedServerFilter, setSelectedServerFilter] = useState<string>('all');
  const [ingestingWebhook, setIngestingWebhook] = useState(false);
  const [runningKaggleJob, setRunningKaggleJob] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const fetchSystemState = async () => {
    try {
      const res = await fetch('/api/system/state');
      const data: SystemState = await res.json();
      setState(data);
      if (data.ambientEvents.length > 0 && !data.ambientEvents.some((e) => e.eventId === selectedEventId)) {
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
    if (typeof window !== 'undefined') {
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setPaletteOpen((prev) => !prev);
        }
      };
      window.addEventListener('keydown', onKey);
      if ('EventSource' in window) {
        const es = new EventSource('/api/events/stream');
        const refresh = () => fetchSystemState();
        ['webhook.ingested', 'approval.executed', 'playbook.distilled', 'slack.message.posted'].forEach((evt) =>
          es.addEventListener(evt, refresh)
        );
        return () => {
          window.removeEventListener('keydown', onKey);
          es.close();
        };
      }
      return () => window.removeEventListener('keydown', onKey);
    }
    return undefined;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('monopulse_active_module', activeModule);
      localStorage.setItem('monopulse_caller_role', callerRole);
    } catch {
      // Ignore storage quota errors
    }
  }, [activeModule, callerRole]);

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
          channelOrTicket: params.service === 'checkout-ledger-svc' ? '#inc-prod-alerts · OPS-4821' : 'OPS-4819 · #tier2-customer-escalations',
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
      body: JSON.stringify({ callerRole, editedMutations: editedList })
    });
    const data = await res.json();
    await fetchSystemState();
    if (data.success) {
      return { type: 'success', message: `1-Click Approval executed (${data.results.length} mutations verified under role '${callerRole}').` };
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

  const sidebarModules: { id: ActiveModule; label: string; badge: string | number; Icon: any }[] = [
    { id: 'ambient', label: '01. Ambient Event Bus', badge: state.ambientEvents.length, Icon: Layers },
    { id: 'mcp', label: '02. MCP Tool Boundary', badge: '6 / 28', Icon: ShieldAlert },
    { id: 'memory', label: '03. Memory & Playbooks', badge: state.pgvectorPlaybooks.length, Icon: Database },
    { id: 'cli', label: '04. Live CLI & Wire Log', badge: state.wireLog.length, Icon: Terminal },
    { id: 'audit', label: '05. SQLite & Crypto Audit', badge: 'HMAC', Icon: Lock }
  ];

  const kpiCards = [
    { label: 'MCP Tool Surface & Boundary', primary: '6 Servers · 28 Tools', primaryColor: 'text-[#F9FAFB]', secondary: '', secondaryColor: '', footer: 'Draft-07 JSON Schema · Granular RBAC Gate' },
    { label: 'Playbook Extractor Efficiency', primary: `-${state.metrics.avgStepReductionPct}% Steps`, primaryColor: 'text-[#16A34A]', secondary: '8.0 → 5.0 avg', secondaryColor: 'text-[#9CA3AF]', footer: 'pgvector cosine injection + Kaggle GPU distillation' },
    { label: 'Perceived Incident Triage Latency', primary: '0.4s Ambient', primaryColor: 'text-[#F9FAFB]', secondary: 'vs 46.4s Sync Chat', secondaryColor: 'text-[#D97706]', footer: 'Pre-computed on webhook arrival · 0 clarifying questions' },
    { label: 'Weekly Active Operator Retention', primary: '84.0% Retained', primaryColor: 'text-[#16A34A]', secondary: 'Up from 28.0%', secondaryColor: 'text-[#DC2626]', footer: 'Eliminated 72% week-one chat abandonment drop-off' }
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex flex-col">
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

        <nav role="tablist" aria-label="MonoPulse Modules" className="hidden md:flex items-center gap-7 text-sm font-medium text-[#9CA3AF]">
          {MODULE_TABS.map((tab, idx) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeModule === tab.id}
              onClick={() => setActiveModule(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setActiveModule(MODULE_TABS[(idx + 1) % MODULE_TABS.length].id);
                else if (e.key === 'ArrowLeft') setActiveModule(MODULE_TABS[(idx - 1 + MODULE_TABS.length) % MODULE_TABS.length].id);
              }}
              className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                activeModule === tab.id ? 'text-[#F9FAFB] border-[#2563EB]' : 'border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open Command Palette"
            className="px-2.5 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:text-[#F9FAFB] rounded-md cursor-pointer"
          >
            ⌘K
          </button>
          <button
            onClick={() =>
              handleEmitWebhook({
                source: 'slack.incident.webhook',
                service: 'checkout-ledger-svc',
                summary: '[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'
              })
            }
            disabled={ingestingWebhook}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-md hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {ingestingWebhook ? 'Pre-Computing Event...' : 'Emit Incident Webhook'}
          </button>
        </div>
      </header>

      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 border-b border-[#1F2937] bg-[#0E131F]">
        {MODULE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveModule(tab.id)}
            className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap ${
              activeModule === tab.id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tools={state.mcpTools}
        onSelectModule={setActiveModule}
        onSelectRole={setCallerRole}
        onSelectToolServer={setSelectedServerFilter}
        onEmitWebhook={() =>
          handleEmitWebhook({
            source: 'slack.incident.webhook',
            service: 'checkout-ledger-svc',
            summary: '[FIRING: P0] Command Palette triggered canary dep-9042 diagnostic trace'
          })
        }
      />

      <div className="flex-1 flex min-h-0">
        <aside className="w-[268px] shrink-0 border-r border-[#1F2937] bg-[#0E131F] p-5 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-6">
            <div>
              <div className="text-xs font-medium text-[#9CA3AF] mb-2">System Modules</div>
              <div className="space-y-1">
                {sidebarModules.map(({ id, label, badge, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveModule(id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      activeModule === id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{label}</span>
                    </span>
                    <span className="font-mono tabular-nums">{badge}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-xs font-medium text-[#9CA3AF] mb-1.5">Active Caller RBAC Token</div>
              <p className="text-xs text-[#9CA3AF]/80 mb-3 leading-relaxed">
                Enforced at the MCP JSON-RPC boundary before any tool handler executes.
              </p>
              <div className="space-y-1.5">
                {RBAC_ROLES_META.map((item) => (
                  <button
                    key={item.role}
                    onClick={() => setCallerRole(item.role)}
                    className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                      callerRole === item.role ? 'bg-[#111827] border-[#2563EB] text-[#F9FAFB]' : 'bg-[#0B0F17] border-[#1F2937] text-[#9CA3AF] hover:border-slate-700'
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
              <div className="text-xs font-medium text-[#9CA3AF] mb-2.5">Mounted MCP Servers (JSON-RPC 2.0)</div>
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
                    <span className="font-mono tabular-nums text-[#9CA3AF]">{srv.toolCount} tools</span>
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
            {kpiCards.map((card) => (
              <div key={card.label} className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg">
                <div className="text-xs text-[#9CA3AF]">{card.label}</div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${card.primaryColor}`}>{card.primary}</span>
                  {card.secondary && <span className={`text-xs font-mono tabular-nums ${card.secondaryColor}`}>{card.secondary}</span>}
                </div>
                <div className="mt-1 text-xs text-[#9CA3AF]">{card.footer}</div>
              </div>
            ))}
          </section>

          <ErrorBoundary>
            {activeModule === 'ambient' && (
              <AmbientPanel events={state.ambientEvents} selectedEventId={selectedEventId} onSelectEventId={setSelectedEventId} callerRole={callerRole} onChangeCallerRole={setCallerRole} onRefreshSystemState={fetchSystemState} ingestingWebhook={ingestingWebhook} runningKaggleJob={runningKaggleJob} onEmitWebhook={handleEmitWebhook} onApproveEvent={handleApproveEvent} onDistillEvent={handleDistillEvent} />
            )}
            {activeModule === 'mcp' && (
              <McpPanel servers={state.mcpServers} tools={state.mcpTools} callerRole={callerRole} onChangeCallerRole={setCallerRole} selectedServerFilter={selectedServerFilter} onSelectServerFilter={setSelectedServerFilter} onRefreshState={fetchSystemState} />
            )}
            {activeModule === 'memory' && (
              <MemoryPanel avgStepReductionPct={state.metrics.avgStepReductionPct} pgvectorPlaybooks={state.pgvectorPlaybooks} redisTier1={state.redisTier1} kaggleGpuJobs={state.kaggleGpuJobs} selectedEventId={selectedEventId} onRefreshState={fetchSystemState} />
            )}
            {activeModule === 'cli' && (
              <CliPanel wireLog={state.wireLog} callerRole={callerRole} onRefreshState={fetchSystemState} />
            )}
            {activeModule === 'audit' && <TrustAuditPanel callerRole={callerRole} />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
