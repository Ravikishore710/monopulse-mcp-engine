import React, { useEffect, useState } from 'react';
import { Activity, BookOpen, Download, Layers, Lock, MessageSquare, Moon, Plus, ShieldAlert, Sun } from 'lucide-react';
import { ActiveModule, AmbientEventRecord, normalizeActiveModule, RBACRole, SystemState } from './types/monopulse.ts';
import { AmbientPanel } from './components/AmbientPanel.tsx';
import { SlackWorkspaceSimulator } from './components/SlackWorkspaceSimulator.tsx';
import { McpPanel } from './components/McpPanel.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { TrustAuditPanel } from './components/TrustAuditPanel.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';

const MODULE_TABS: { id: 'incidents' | 'workspace' | 'integrations' | 'playbooks' | 'audit'; label: string; summary: string }[] = [
  { id: 'incidents', label: 'Incidents', summary: 'Incident triage, root-cause diagnostics, and 1-Click approval execution' },
  { id: 'workspace', label: 'Workspace', summary: 'Bridged incident channels across Slack, MS Teams, PagerDuty, and ArgoCD' },
  { id: 'integrations', label: 'Integrations', summary: 'Connected observability, ticketing, cloud, custom webhooks, and MCP tools' },
  { id: 'playbooks', label: 'Playbooks', summary: 'Semantic runbook library and automated trajectory distillation' },
  { id: 'audit', label: 'Audit & Settings', summary: 'SQLite ledger, SHA-256 hash-chain verification, CLI harness, and sandbox' }
];

const RBAC_ROLES_META: { role: RBACRole; label: string; scope: string }[] = [
  { role: 'sre_admin', label: 'SRE Administrator', scope: 'Full Read & Production Mutations' },
  { role: 'eng_lead', label: 'Engineering Lead', scope: 'Read + Code & Ticket Updates' },
  { role: 'support_tier2', label: 'Tier-2 Escalation', scope: 'Read + Status Broadcasts' },
  { role: 'readonly_analyst', label: 'Read-Only Analyst', scope: 'Diagnostics Only (No Writes)' }
];

export default function App() {
  const [state, setState] = useState<SystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportedCsvCount, setExportedCsvCount] = useState<number | null>(null);
  const [activeModule, setActiveModule] = useState<ActiveModule>(() => {
    try {
      const hashVal = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
      return normalizeActiveModule(hashVal || localStorage.getItem('monopulse_active_module'));
    } catch (_storageErr: unknown) { return 'incidents'; }
  });
  const [callerRole, setCallerRole] = useState<RBACRole>(() => {
    try { return (localStorage.getItem('monopulse_caller_role') as RBACRole) || 'sre_admin'; }
    catch (_roleErr: unknown) { return 'sre_admin'; }
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('monopulse_theme') === 'light' ? 'light' : 'dark'; }
    catch (_themeErr: unknown) { return 'dark'; }
  });
  const [selectedEventId, setSelectedEventId] = useState<string>('evt-ambient-901');
  const [selectedServerFilter, setSelectedServerFilter] = useState<string>('all');
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
    } catch (err: unknown) {
      if (err instanceof Error) setState((prev) => prev);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchSystemState();
    if (typeof window === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((prev) => !prev); }
    };
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) setActiveModule(normalizeActiveModule(hash));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHashChange);
    if ('EventSource' in window) {
      const es = new EventSource('/api/events/stream');
      const refresh = () => fetchSystemState();
      ['webhook.ingested', 'approval.executed', 'playbook.distilled', 'slack.message.posted', 'simulation.toggled', 'integration.created'].forEach((evt) => es.addEventListener(evt, refresh));
      return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHashChange); es.close(); };
    }
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHashChange); };
  }, []);

  useEffect(() => {
    try {
      const normalized = normalizeActiveModule(activeModule);
      localStorage.setItem('monopulse_active_module', normalized);
      localStorage.setItem('monopulse_caller_role', callerRole);
      localStorage.setItem('monopulse_theme', theme);
      if (typeof document !== 'undefined') document.documentElement.classList.toggle('light', theme === 'light');
      if (typeof window !== 'undefined' && window.location.hash !== `#${normalized}`) {
        window.history.replaceState(null, '', `#${normalized}`);
      }
    } catch (persistErr: unknown) {
      if (persistErr instanceof Error && typeof document !== 'undefined') document.documentElement.classList.toggle('light', theme === 'light');
    }
  }, [activeModule, callerRole, theme]);

  const handleEmitWebhook = async (params: {
    source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
    service: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
    summary: string;
  }) => {
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
    if (data.event?.eventId) { setSelectedEventId(data.event.eventId); setActiveModule('incidents'); }
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
    if (data.success) return { type: 'success', message: `Approved and executed ${data.results.length} staged actions under role '${callerRole}'.` };
    const failed = data.results?.find((r: any) => r.status !== 'SUCCESS');
    return { type: 'error', message: `Policy denied '${failed?.toolName}': ${failed?.detail?.message || 'Insufficient RBAC permissions.'}` };
  };

  const handleDistillEvent = async (eventId: string) => {
    setRunningKaggleJob(true);
    try {
      await fetch('/api/kaggle/distill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId }) });
      await fetchSystemState();
      setActiveModule('playbooks');
    } finally { setRunningKaggleJob(false); }
  };

  const handleToggleSim = async (enabled: boolean) => {
    await fetch('/api/system/simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    await fetchSystemState();
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex items-center justify-center p-8">
        <div className="max-w-md w-full border border-[#1F2937] bg-[#111827] p-6 rounded-lg space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-[#9CA3AF]"><span>MONOPULSE CONTROL PLANE</span><span>LOADING</span></div>
          <div className="h-1.5 bg-[#1F2937] rounded overflow-hidden"><div className="h-full w-2/3 bg-[#2563EB]" /></div>
          <p className="text-xs text-[#9CA3AF]">Synchronizing active incidents, workspace bridges, and integrations...</p>
        </div>
      </div>
    );
  }

  const currentPage = normalizeActiveModule(activeModule);
  const activeTabMeta = MODULE_TABS.find((t) => t.id === currentPage) || MODULE_TABS[0];
  const pendingCount = state.ambientEvents.filter((e) => e.approvalState === 'STAGED_1CLICK_READY').length;
  const resolvedCount = state.ambientEvents.length - pendingCount;

  const sidebarModules: { id: 'incidents' | 'workspace' | 'integrations' | 'playbooks' | 'audit'; label: string; count: string | number; Icon: any }[] = [
    { id: 'incidents', label: 'Incidents', count: state.ambientEvents.length, Icon: Layers },
    { id: 'workspace', label: 'Workspace', count: 4, Icon: MessageSquare },
    { id: 'integrations', label: 'Integrations', count: 9 + state.mcpServers.length, Icon: ShieldAlert },
    { id: 'playbooks', label: 'Playbooks', count: state.pgvectorPlaybooks.length, Icon: BookOpen },
    { id: 'audit', label: 'Audit & Settings', count: state.wireLog.length, Icon: Lock }
  ];

  const telemetryMetrics = [
    {
      label: 'Tracked Incidents',
      value: state.ambientEvents.length,
      unit: 'TOTAL',
      meta: `${resolvedCount} resolved · ${pendingCount} queued`,
      barWidth: resolvedCount > 0 ? 'w-3/4' : 'w-1/2',
      barGradient: 'bg-gradient-to-r from-blue-600/90 via-blue-400 to-cyan-300'
    },
    {
      label: 'Pending Approvals',
      value: pendingCount,
      unit: 'STAGED',
      meta: `Active role: ${callerRole}`,
      barWidth: pendingCount > 0 ? 'w-2/3' : 'w-full',
      barGradient: pendingCount > 0
        ? 'bg-gradient-to-r from-amber-500/90 via-amber-400 to-yellow-300'
        : 'bg-gradient-to-r from-emerald-600/90 via-emerald-400 to-teal-300'
    },
    {
      label: 'Connected Integrations',
      value: state.mcpServers.length + 9,
      unit: 'ACTIVE',
      meta: `${state.mcpServers.length} MCP · 9 Bridges (${state.mcpTools.length} tools)`,
      barWidth: 'w-full',
      barGradient: 'bg-gradient-to-r from-emerald-600/90 via-emerald-400 to-teal-300'
    },
    {
      label: 'Audit Ledger Frames',
      value: state.wireLog.length,
      unit: 'FRAMES',
      meta: state.simulationMode ? 'Sandbox Simulation' : 'SHA-256 Verified',
      barWidth: 'w-11/12',
      barGradient: 'bg-gradient-to-r from-indigo-600/90 via-blue-500 to-sky-300'
    }
  ];

  const handleExportTelemetryCsv = () => {
    const header = 'record_type,id,timestamp,service_or_server,action_or_source,role_or_ticket,status,latency_ms';
    const incidentRows = state.ambientEvents.map((e) => `incident,${e.eventId},${e.receivedAt},${e.service},${e.source},"${e.channelOrTicket}",${e.approvalState},${e.precomputeLatencyMs}`);
    const auditRows = state.wireLog.map((w) => `audit,${w.frameId},${w.timestamp},${w.serverId},${w.toolName},${w.callerRole},${w.status},${w.latencyMs}`);
    const csv = [header, ...incidentRows, ...auditRows].join('\n');
    setExportedCsvCount(incidentRows.length + auditRows.length);
    if (typeof window !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'monopulse-incident-audit-telemetry.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F9FAFB] flex flex-col">
      <header className="flex items-center justify-between gap-6 px-6 py-3.5 border-b border-[#1F2937] bg-[#0B0F17]/95 backdrop-blur sticky top-0 z-30">
        <div className="flex items-center gap-3 shrink-0">
          <a href="#incidents" onClick={(e) => { e.preventDefault(); setActiveModule('incidents'); }} className="text-base font-semibold tracking-tight text-[#F9FAFB] font-display whitespace-nowrap flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#2563EB]" /><span>MonoPulse</span>
          </a>
          <span className="text-xs text-[#9CA3AF] hidden sm:inline">/ {activeTabMeta.label}</span>
        </div>

        <nav role="tablist" aria-label="Primary Navigation" className="hidden md:flex items-center gap-7 text-xs font-medium text-[#9CA3AF]">
          {MODULE_TABS.map((tab, idx) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={currentPage === tab.id}
              onClick={() => setActiveModule(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setActiveModule(MODULE_TABS[(idx + 1) % MODULE_TABS.length].id);
                else if (e.key === 'ArrowLeft') setActiveModule(MODULE_TABS[(idx - 1 + MODULE_TABS.length) % MODULE_TABS.length].id);
              }}
              className={`hover:text-[#F9FAFB] transition-colors whitespace-nowrap shrink-0 py-1.5 border-b-2 cursor-pointer ${currentPage === tab.id ? 'text-[#F9FAFB] border-[#2563EB] font-semibold' : 'border-transparent'}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={() => setPaletteOpen(true)} aria-label="Open Command Palette" className={`px-3 py-1.5 text-xs font-mono border rounded-md cursor-pointer whitespace-nowrap ${state.simulationMode ? 'border-[#D97706] bg-[#D97706]/15 text-[#D97706]' : 'border-[#1F2937] bg-[#111827] text-[#F9FAFB] hover:border-slate-600'}`}>
            {state.simulationMode ? '⌘K · Sandbox' : '⌘K · Search'}
          </button>
          <button onClick={() => handleEmitWebhook({ source: 'slack.incident.webhook', service: 'checkout-ledger-svc', summary: '[ALERT: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.' })} className="px-3.5 py-1.5 text-xs font-medium bg-[#2563EB] hover:bg-blue-500 text-white rounded-md transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /><span>New Incident</span>
          </button>
        </div>
      </header>

      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 border-b border-[#1F2937] bg-[#0E131F]">
        {MODULE_TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveModule(tab.id)} className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap ${currentPage === tab.id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF]'}`}>{tab.label}</button>
        ))}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} tools={state.mcpTools} simulationMode={Boolean(state.simulationMode)} onToggleSimulationMode={handleToggleSim} onSelectModule={setActiveModule} onSelectRole={setCallerRole} onSelectToolServer={setSelectedServerFilter} onEmitWebhook={() => handleEmitWebhook({ source: 'slack.incident.webhook', service: 'checkout-ledger-svc', summary: '[ALERT: P0] Command Palette triggered canary dep-9042 diagnostic trace' })} />

      <div className="flex-1 flex min-h-0">
        <aside className="w-[248px] shrink-0 border-r border-[#1F2937] bg-[#0E131F] p-5 flex flex-col justify-between hidden lg:flex">
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">Navigation</span>
                <button onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))} aria-label="Toggle Theme" className="px-2 py-1 text-[11px] font-mono border border-[#1F2937] bg-[#111827] text-[#F9FAFB] rounded hover:border-slate-600 cursor-pointer flex items-center gap-1">
                  {theme === 'dark' ? <Sun className="w-3 h-3 text-[#D97706]" /> : <Moon className="w-3 h-3 text-[#2563EB]" />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                </button>
              </div>
              <div className="space-y-1">
                {sidebarModules.map(({ id, label, count, Icon }) => (
                  <button key={id} onClick={() => setActiveModule(id)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${currentPage === id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'}`}>
                    <span className="flex items-center gap-2.5"><Icon className="w-3.5 h-3.5 shrink-0" /><span>{label}</span></span>
                    <span className="font-mono text-[11px] tabular-nums opacity-85">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF] mb-2">Operator Role</div>
              <div className="space-y-1.5">
                {RBAC_ROLES_META.map((item) => (
                  <button key={item.role} onClick={() => setCallerRole(item.role)} className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${callerRole === item.role ? 'bg-[#111827] border-[#2563EB] text-[#F9FAFB]' : 'bg-[#0B0F17] border-[#1F2937] text-[#9CA3AF] hover:border-slate-700'}`}>
                    <div className="flex items-center justify-between text-xs font-medium"><span>{item.label}</span><span className="font-mono text-[10px] text-[#9CA3AF]">{item.role}</span></div>
                    <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{item.scope}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-5 border-t border-[#1F2937]">
              <div className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF] mb-2">MCP Transports</div>
              <div className="space-y-1.5 text-xs">
                {state.mcpServers.map((srv) => (
                  <button key={srv.id} onClick={() => { setSelectedServerFilter(srv.id); setActiveModule('integrations'); }} className="w-full flex items-center justify-between text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer py-0.5 text-left">
                    <span className="font-mono text-[11px] truncate">{srv.id}</span>
                    <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">{srv.toolCount}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#1F2937] text-[11px] text-[#9CA3AF] space-y-1 font-mono">
            <div>Env · {state.simulationMode ? 'Sandbox' : 'Production'}</div>
            <div>Store · SQLite + Redis</div>
          </div>
        </aside>

        <main id="top" className="flex-1 min-w-0 p-6 lg:p-8 space-y-6 overflow-y-auto">
          <section aria-label="Telemetry Metrics" className="relative rounded-2xl border border-[#1F2937] bg-[#111827]/75 backdrop-blur-xl p-4 sm:p-5 shadow-[0_12px_36px_-10px_rgba(0,0,0,0.55)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1F2937]/80">
              <div className="flex items-center gap-2.5 text-xs">
                <Activity className="w-4 h-4 text-[#2563EB]" />
                <span className="font-semibold tracking-tight text-[#F9FAFB]">Live Operational Telemetry</span>
                <span className="font-mono text-[11px] text-[#9CA3AF] hidden sm:inline">· 99.98% SLA · -{state.metrics.avgStepReductionPct}% steps</span>
                {exportedCsvCount !== null && <span className="font-mono text-[11px] text-[#16A34A]">· Exported {exportedCsvCount} rows</span>}
              </div>
              <button onClick={handleExportTelemetryCsv} aria-label="Export CSV" className="px-3 py-1.5 text-xs font-medium border border-[#1F2937] bg-[#0B0F17]/80 backdrop-blur-md text-[#F9FAFB] hover:border-[#2563EB] rounded-lg flex items-center gap-1.5 cursor-pointer transition-all">
                <Download className="w-3.5 h-3.5 text-[#2563EB]" /><span>Export CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
              {telemetryMetrics.map((m) => (
                <div key={m.label} className="p-4 rounded-xl border border-[#1F2937]/90 bg-[#0B0F17]/65 backdrop-blur-md flex flex-col justify-between space-y-3 hover:border-slate-700/80 transition-colors">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium tracking-tight text-[#F9FAFB]/90">{m.label}</span>
                    <span className="font-mono text-[10px] tracking-widest text-[#9CA3AF]">{m.unit}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-3xl font-semibold font-mono tabular-nums tracking-tight text-[#F9FAFB]">{m.value}</span>
                    <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF] truncate">{m.meta}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[#1F2937]/80 rounded-full overflow-hidden">
                    <div className={`h-full ${m.barWidth} ${m.barGradient} rounded-full`} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <ErrorBoundary>
            {currentPage === 'incidents' && (
              <AmbientPanel events={state.ambientEvents} selectedEventId={selectedEventId} onSelectEventId={setSelectedEventId} callerRole={callerRole} onChangeCallerRole={setCallerRole} onRefreshSystemState={fetchSystemState} runningKaggleJob={runningKaggleJob} onApproveEvent={handleApproveEvent} onDistillEvent={handleDistillEvent} />
            )}
            {currentPage === 'workspace' && (
              <SlackWorkspaceSimulator callerRole={callerRole} onChangeCallerRole={setCallerRole} onRefreshSystemState={fetchSystemState} onSelectIncident={(eventId: string) => { setSelectedEventId(eventId); setActiveModule('incidents'); }} />
            )}
            {currentPage === 'integrations' && (
              <McpPanel servers={state.mcpServers} tools={state.mcpTools} callerRole={callerRole} onChangeCallerRole={setCallerRole} selectedServerFilter={selectedServerFilter} onSelectServerFilter={setSelectedServerFilter} onRefreshState={fetchSystemState} onNavigateToIncident={(eventId: string) => { setSelectedEventId(eventId); setActiveModule('incidents'); }} />
            )}
            {currentPage === 'playbooks' && (
              <MemoryPanel avgStepReductionPct={state.metrics.avgStepReductionPct} pgvectorPlaybooks={state.pgvectorPlaybooks} redisTier1={state.redisTier1} kaggleGpuJobs={state.kaggleGpuJobs} selectedEventId={selectedEventId} onRefreshState={fetchSystemState} />
            )}
            {currentPage === 'audit' && (
              <TrustAuditPanel callerRole={callerRole} wireLog={state.wireLog} simulationMode={Boolean(state.simulationMode)} onToggleSimulationMode={handleToggleSim} onEmitWebhook={handleEmitWebhook} onRefreshState={fetchSystemState} />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
