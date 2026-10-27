import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Download, Lock, Play, RefreshCw, Terminal, Wrench } from 'lucide-react';
import { MCPWireFrame, RBACRole } from '../types/monopulse.ts';
import { CliPanel } from './CliPanel.tsx';
import { executeJsonRequest, useApiAction } from '../hooks/useApiAction.ts';
import { THEME } from '../theme.ts';

interface AuditData {
  sqliteDatabase: {
    engine: string;
    storagePath: string;
    tables: { name: string; rowCount: number }[];
  };
  connectorModes: {
    serverId: string;
    provider: string;
    mode: string;
    envVarConfigured: boolean;
    endpointBase: string;
    circuitState?: string;
  }[];
  hashChainIntegrity?: {
    valid: boolean;
    verifiedRows: number;
    genesisHash: string;
    headHash: string;
    tamperedFrameId: string | null;
  };
  auditLogEntries: Record<string, any>[];
}

interface TrustAuditPanelProps {
  callerRole: RBACRole;
  wireLog?: MCPWireFrame[];
  simulationMode?: boolean;
  onToggleSimulationMode?: (enabled: boolean) => Promise<void>;
  onEmitWebhook?: (params: {
    source: 'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert';
    service: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
    summary: string;
  }) => Promise<void>;
  onRefreshState?: () => Promise<void>;
}

export function TrustAuditPanel({
  callerRole,
  wireLog = [],
  simulationMode = false,
  onToggleSimulationMode,
  onEmitWebhook,
  onRefreshState
}: TrustAuditPanelProps) {
  const [subTab, setSubTab] = useState<'ledger' | 'cli' | 'sandbox'>('ledger');
  const { data: auditData, loading: loadingAudit, runAction: runLoadAudit } = useApiAction<AuditData>();
  const [showConnectorDetails, setShowConnectorDetails] = useState<boolean>(false);
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT d.deploy_id, d.service, d.status, i.error_rate_pct, i.p99_latency_ms FROM deployments d JOIN service_incidents i ON d.service = i.service'
  );
  const [sqlResult, setSqlResult] = useState<Record<string, any> | null>(null);
  const [cryptoTestResult, setCryptoTestResult] = useState<Record<string, any> | null>(null);
  const [hashChainCheck, setHashChainCheck] = useState<Record<string, any> | null>(null);

  const [webhookSource, setWebhookSource] = useState<'slack.incident.webhook' | 'jira.issue.created' | 'github.canary.alert'>('slack.incident.webhook');
  const [webhookService, setWebhookService] = useState<'checkout-ledger-svc' | 'webhook-dispatcher-v2'>('checkout-ledger-svc');
  const [webhookSummary, setWebhookSummary] = useState<string>(
    '[FIRING: P0] checkout-ledger-svc 5xx error spike (14.8%) & PgBouncer saturation (98%) after canary dep-9042 rollout.'
  );
  const { data: sandboxReport, loading: runningSandboxTask, runAction: runStressAction } = useApiAction<Record<string, any>>();

  const loadAuditState = async () => {
    const data = await runLoadAudit('/api/security/audit');
    if (data?.hashChainIntegrity) setHashChainCheck(data.hashChainIntegrity);
  };

  useEffect(() => {
    loadAuditState();
  }, []);

  const handleRunLiveSqliteQuery = async () => {
    const { data } = await executeJsonRequest('/api/mcp/rpc', {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'sql_execute_readonly_query', arguments: { query: sqlQuery, row_limit: 20 }, callerRole }
      }
    });
    setSqlResult(data);
    await loadAuditState();
  };

  const handleVerifyHashChain = async () => {
    const { data } = await executeJsonRequest('/api/security/hash-chain/verify');
    setHashChainCheck(data);
  };

  const handleTestHmacVerification = async (simulateTamper: boolean) => {
    const { data } = await executeJsonRequest('/api/security/verify-signature', {
      method: 'POST',
      body: {
        toolName: 'infra_trigger_canary_rollback',
        args: { deploy_id: 'dep-9042', reason: 'Verified SRE rollback' },
        tamperArgs: simulateTamper ? { deploy_id: 'dep-9041-UNAUTHORIZED', reason: 'Tampered payload after approval' } : undefined
      }
    });
    setCryptoTestResult(data);
  };

  const handleExportAuditLog = async (format: 'json' | 'csv') => {
    if (!auditData) return;
    const isCsv = format === 'csv';
    const content = isCsv
      ? await (await fetch('/api/security/audit?format=csv')).text()
      : JSON.stringify(auditData.auditLogEntries, null, 2);
    const blob = new Blob([content], { type: isCsv ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monopulse-sqlite-audit-log.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunLoadTest = async () => {
    await runStressAction('/api/system/stress-test', {
      method: 'POST',
      body: { webhookBurstSize: 8, rpcBurstSize: 16, competingApprovers: 6 }
    });
    if (onRefreshState) await onRefreshState();
    await loadAuditState();
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${THEME.HEADER_BORDER}`}>
        <div>
          <h1 className={THEME.TITLE_H1}>Compliance Audit, CLI &amp; System Settings</h1>
          <p className={THEME.TEXT_SUBTITLE}>
            Executive compliance posture, SHA-256 Merkle audit verification, relational SQLite console, and Developer Sandbox.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className={`flex items-center gap-1 p-1 ${THEME.SURFACE_CARD}`}>
            {([
              { id: 'ledger', label: 'Audit & Storage', Icon: Lock },
              { id: 'cli', label: 'CLI & Wire Log', Icon: Terminal },
              { id: 'sandbox', label: 'Developer Sandbox', Icon: Wrench }
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setSubTab(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer flex items-center gap-1.5 ${
                  subTab === id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button onClick={() => handleExportAuditLog('json')} className={`px-3 py-1.5 text-xs font-medium ${THEME.SURFACE_CARD} text-[#F9FAFB] hover:border-slate-600 cursor-pointer flex items-center gap-1.5`}>
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>
          <button onClick={() => handleExportAuditLog('csv')} className={`px-3 py-1.5 text-xs font-medium ${THEME.SURFACE_CARD} text-[#F9FAFB] hover:border-slate-600 cursor-pointer flex items-center gap-1.5`}>
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button onClick={loadAuditState} disabled={loadingAudit} className="px-3 py-1.5 text-xs font-medium bg-[#2563EB] text-white rounded-md hover:bg-blue-500 cursor-pointer flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {subTab === 'cli' && onRefreshState && (
        <CliPanel wireLog={wireLog} callerRole={callerRole} onRefreshState={onRefreshState} />
      )}

      {subTab === 'sandbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`lg:col-span-6 ${THEME.SURFACE_CARD_P5} space-y-4`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className={THEME.TITLE_H2}>Safe Sandbox &amp; Simulation Mode</h2>
                <p className="text-xs text-[#9CA3AF]">Isolate Slack, Jira, and GitHub connectors from live production side effects.</p>
              </div>
              {onToggleSimulationMode && (
                <button
                  onClick={() => onToggleSimulationMode(!simulationMode)}
                  className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md cursor-pointer ${
                    simulationMode ? 'bg-[#D97706] text-white' : 'bg-[#0B0F17] border border-[#1F2937] text-[#F9FAFB]'
                  }`}
                >
                  {simulationMode ? 'SIMULATION: ON' : 'SIMULATION: OFF'}
                </button>
              )}
            </div>
            <div className="pt-3 border-t border-[#1F2937] space-y-3">
              <div className="text-xs font-semibold text-[#F9FAFB]">Ingest Custom Incident Webhook</div>
              <div className="grid grid-cols-2 gap-2">
                <select value={webhookSource} onChange={(e) => setWebhookSource(e.target.value as any)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-2.5 py-1.5 text-xs text-[#F9FAFB]">
                  <option value="slack.incident.webhook">slack.incident.webhook</option>
                  <option value="jira.issue.created">jira.issue.created</option>
                  <option value="github.canary.alert">github.canary.alert</option>
                </select>
                <select value={webhookService} onChange={(e) => setWebhookService(e.target.value as any)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-2.5 py-1.5 text-xs text-[#F9FAFB]">
                  <option value="checkout-ledger-svc">checkout-ledger-svc</option>
                  <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
                </select>
              </div>
              <input type="text" value={webhookSummary} onChange={(e) => setWebhookSummary(e.target.value)} className="w-full bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]" />
              {onEmitWebhook && (
                <button onClick={() => onEmitWebhook({ source: webhookSource, service: webhookService, summary: webhookSummary })} className="px-4 py-2 text-xs font-semibold bg-[#2563EB] text-white rounded-md hover:bg-blue-500 cursor-pointer">
                  Dispatch Webhook to Incident Queue
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#F9FAFB]">Concurrent Burst &amp; Race-Condition Verifier</h2>
                <p className="text-xs text-[#9CA3AF]">Triggers concurrent webhooks, MCP RPC calls, and quorum checks.</p>
              </div>
              <button onClick={handleRunLoadTest} disabled={runningSandboxTask} className="px-3.5 py-1.5 text-xs font-semibold bg-[#16A34A] text-white rounded-md hover:bg-emerald-500 cursor-pointer disabled:opacity-50">
                {runningSandboxTask ? 'Running Burst...' : 'Run Concurrency Verification'}
              </button>
            </div>
            {sandboxReport && (
              <pre className="p-3 bg-[#0B0F17] border border-[#1F2937] rounded-md text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-60">
                {JSON.stringify(sandboxReport, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {subTab === 'ledger' && auditData && (
        <div className="space-y-6">
          {/* Executive Compliance Overview Banner */}
          <div className="border border-[#1F2937] bg-[#111827] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
                Executive Security &amp; Compliance Summary
              </div>
              <p className="text-sm text-[#F9FAFB]/90">
                All {hashChainCheck?.verifiedRows ?? auditData.auditLogEntries.length} audit frames are cryptographically chained via SHA-256 and persisted in {auditData.sqliteDatabase.engine}.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className={hashChainCheck?.valid !== false ? 'text-[#16A34A] font-semibold' : 'text-[#DC2626] font-semibold'}>
                {hashChainCheck?.valid !== false ? 'CRYPTOGRAPHICALLY_VALID' : 'TAMPER_DETECTED'}
              </span>
              <button onClick={handleVerifyHashChain} className="px-3 py-1.5 text-xs font-medium bg-[#16A34A] text-white rounded-md hover:bg-emerald-500 cursor-pointer flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verify Chain</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-5">
              <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#F9FAFB]">Embedded SQLite Storage Engine</h2>
                  <span className="text-xs font-mono text-[#16A34A]">{auditData.sqliteDatabase.engine}</span>
                </div>
                <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                  {auditData.sqliteDatabase.tables.map((t) => (
                    <div key={t.name} className="px-3.5 py-2 flex items-center justify-between text-xs font-mono">
                      <span className="text-[#F9FAFB]">{t.name}</span>
                      <span className="tabular-nums text-[#9CA3AF]">{t.rowCount} rows</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[#F9FAFB]">Connector Endpoints &amp; Circuit Breakers</h2>
                    <p className="text-xs text-[#9CA3AF] mt-0.5">
                      {auditData.connectorModes.length} MCP server transports monitored with automatic fallback.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConnectorDetails((prev) => !prev)}
                    className="text-xs font-medium text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showConnectorDetails ? 'Hide Details' : 'View Full Overview'}</span>
                    {showConnectorDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {showConnectorDetails && (
                  <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                    {auditData.connectorModes.map((c) => (
                      <div key={c.serverId} className="p-3 space-y-1">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-[#F9FAFB] font-semibold">{c.serverId}</span>
                          <span className={c.mode === 'DETERMINISTIC_FALLBACK' ? 'text-[#D97706]' : 'text-[#16A34A]'}>
                            {c.mode} · CB:{c.circuitState || 'CLOSED'}
                          </span>
                        </div>
                        <div className="text-xs text-[#9CA3AF] flex items-center justify-between">
                          <span>{c.provider}</span>
                          <span className="font-mono">{c.endpointBase}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 space-y-5">
              <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#F9FAFB]">Live SQLite Read-Only Query Console</h2>
                  <button onClick={handleRunLiveSqliteQuery} className="px-3.5 py-1.5 text-xs font-semibold bg-[#2563EB] text-white rounded-md hover:bg-blue-500 cursor-pointer flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5" />
                    <span>Execute SQLite Query</span>
                  </button>
                </div>
                <textarea value={sqlQuery} onChange={(e) => setSqlQuery(e.target.value)} rows={3} className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md p-3 text-xs font-mono text-[#F9FAFB]" />
                {sqlResult && (
                  <pre className="p-3 bg-[#0B0F17] border border-[#1F2937] rounded-md text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-52">
                    {JSON.stringify(sqlResult, null, 2)}
                  </pre>
                )}
              </div>

              <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#F9FAFB]">HMAC-SHA256 Approval Token Verifier</h2>
                    <p className="text-xs text-[#9CA3AF]">Verifies cryptographic binding of toolName, canonical JSON arguments digest, and expiry.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleTestHmacVerification(false)} className="px-3 py-1.5 text-xs font-medium bg-[#16A34A] text-white rounded-md hover:bg-emerald-500 cursor-pointer flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Verify Token</span>
                    </button>
                    <button onClick={() => handleTestHmacVerification(true)} className="px-3 py-1.5 text-xs font-medium bg-[#DC2626] text-white rounded-md hover:bg-red-500 cursor-pointer">
                      Simulate Tamper
                    </button>
                  </div>
                </div>
                {cryptoTestResult && (
                  <pre className="p-3 bg-[#0B0F17] border border-[#1F2937] rounded-md text-xs font-mono text-[#F9FAFB] overflow-x-auto">
                    {JSON.stringify(cryptoTestResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
