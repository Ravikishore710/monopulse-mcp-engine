import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Lock, Play, RefreshCw } from 'lucide-react';
import { RBACRole } from '../types/monopulse.ts';

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
  deadLetterQueue?: {
    dlqId: string;
    source: string;
    errorReason: string;
    retryCount: number;
    status: string;
  }[];
  securityPosture: {
    webhookSignatureAlgorithm: string;
    approvalTokenAlgorithm: string;
    auditHashChainAlgorithm?: string;
    rateLimitMaxPerMinute: number;
    securityHeadersActive: string[];
  };
  auditLogEntries: Record<string, any>[];
}

export function TrustAuditPanel({ callerRole }: { callerRole: RBACRole }) {
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT d.deploy_id, d.service, d.status, i.error_rate_pct, i.p99_latency_ms FROM deployments d JOIN service_incidents i ON d.service = i.service'
  );
  const [sqlResult, setSqlResult] = useState<Record<string, any> | null>(null);
  const [cryptoTestResult, setCryptoTestResult] = useState<Record<string, any> | null>(null);
  const [hashChainCheck, setHashChainCheck] = useState<Record<string, any> | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadAuditState = async () => {
    setLoadingAudit(true);
    try {
      const res = await fetch('/api/security/audit');
      const data = await res.json();
      setAuditData(data);
      if (data.hashChainIntegrity) {
        setHashChainCheck(data.hashChainIntegrity);
      }
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    loadAuditState();
  }, []);

  const handleRunLiveSqliteQuery = async () => {
    const res = await fetch('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'sql_execute_readonly_query',
          arguments: { query: sqlQuery, row_limit: 20 },
          callerRole
        }
      })
    });
    const data = await res.json();
    setSqlResult(data);
    await loadAuditState();
  };

  const handleVerifyHashChain = async () => {
    const res = await fetch('/api/security/hash-chain/verify');
    const data = await res.json();
    setHashChainCheck(data);
  };

  const handleTestHmacVerification = async (simulateTamper: boolean) => {
    const res = await fetch('/api/security/verify-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'infra_trigger_canary_rollback',
        args: { deploy_id: 'dep-9042', reason: 'Verified SRE rollback' },
        tamperArgs: simulateTamper
          ? { deploy_id: 'dep-9041-UNAUTHORIZED', reason: 'Tampered payload after approval' }
          : undefined
      })
    });
    const data = await res.json();
    setCryptoTestResult(data);
  };

  const handleExportAuditLog = async (format: 'json' | 'csv') => {
    if (!auditData) return;
    if (format === 'csv') {
      const res = await fetch('/api/security/audit?format=csv');
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'monopulse-sqlite-audit-log.csv';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const blob = new Blob([JSON.stringify(auditData.auditLogEntries, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'monopulse-sqlite-audit-log.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
            05. Embedded SQLite Persistence, SHA-256 Hash-Chain &amp; Cryptographic Audit
          </h1>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Inspect the live relational SQLite database, verify the tamper-evident SHA-256 Merkle audit chain, and test HMAC-SHA256 token integrity.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => handleExportAuditLog('json')}
            className="px-3 py-1.5 text-xs font-medium border border-[#1F2937] bg-[#111827] text-[#F9FAFB] rounded-md hover:border-slate-600 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON Audit</span>
          </button>
          <button
            onClick={() => handleExportAuditLog('csv')}
            className="px-3 py-1.5 text-xs font-medium border border-[#1F2937] bg-[#111827] text-[#F9FAFB] rounded-md hover:border-slate-600 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV Audit</span>
          </button>
          <button
            onClick={loadAuditState}
            disabled={loadingAudit}
            className="px-3 py-1.5 text-xs font-medium bg-[#2563EB] text-white rounded-md hover:bg-blue-500 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh State</span>
          </button>
        </div>
      </div>

      {auditData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-5">
            <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F9FAFB]">Embedded SQLite Storage Engine</h2>
                <span className="text-xs font-mono text-[#16A34A]">{auditData.sqliteDatabase.engine}</span>
              </div>
              <div className="text-xs font-mono text-[#9CA3AF]">
                Path: {auditData.sqliteDatabase.storagePath}
              </div>
              <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                {auditData.sqliteDatabase.tables.map((t) => (
                  <div
                    key={t.name}
                    className="px-3.5 py-2.5 flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-[#F9FAFB]">{t.name}</span>
                    <span className="tabular-nums text-[#9CA3AF]">{t.rowCount} rows</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F9FAFB]">
                  SHA-256 Tamper-Evident Audit Hash Chain
                </h2>
                <button
                  onClick={handleVerifyHashChain}
                  className="px-2.5 py-1 text-xs font-medium bg-[#16A34A] text-white rounded hover:bg-emerald-500 cursor-pointer flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verify Chain</span>
                </button>
              </div>
              {hashChainCheck && (
                <div className="p-3 bg-[#0B0F17] border border-[#1F2937] rounded text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[#9CA3AF]">Chain Integrity:</span>
                    <span className={hashChainCheck.valid ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                      {hashChainCheck.valid ? 'CRYPTOGRAPHICALLY_VALID' : 'TAMPER_DETECTED'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#9CA3AF]">
                    <span>Verified Frames:</span>
                    <span className="text-[#F9FAFB] tabular-nums">{hashChainCheck.verifiedRows}</span>
                  </div>
                  <div className="text-[11px] text-[#9CA3AF] truncate">
                    Head SHA-256: {hashChainCheck.headHash}
                  </div>
                </div>
              )}
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
              <h2 className="text-sm font-semibold text-[#F9FAFB]">
                MCP Server Connectors &amp; Circuit Breakers
              </h2>
              <div className="divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                {auditData.connectorModes.map((c) => (
                  <div key={c.serverId} className="p-3 space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#F9FAFB] font-semibold">{c.serverId}</span>
                      <span
                        className={
                          c.mode === 'DETERMINISTIC_FALLBACK' ? 'text-[#D97706]' : 'text-[#16A34A]'
                        }
                      >
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
            </div>
          </div>

          <div className="lg:col-span-7 space-y-5">
            <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F9FAFB]">
                  Live SQLite Read-Only Query Console (sql-ops-mcp)
                </h2>
                <button
                  onClick={handleRunLiveSqliteQuery}
                  className="px-3.5 py-1.5 text-xs font-semibold bg-[#2563EB] text-white rounded-md hover:bg-blue-500 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute SQLite Query</span>
                </button>
              </div>
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                rows={3}
                className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md p-3 text-xs font-mono text-[#F9FAFB]"
              />
              {sqlResult && (
                <pre className="p-3 bg-[#0B0F17] border border-[#1F2937] rounded-md text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-52">
                  {JSON.stringify(sqlResult, null, 2)}
                </pre>
              )}
            </div>

            <div className="border border-[#1F2937] bg-[#111827] p-5 rounded-lg space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#F9FAFB]">
                    HMAC-SHA256 Approval Token Cryptographic Verifier
                  </h2>
                  <p className="text-xs text-[#9CA3AF]">
                    Tokens bind toolName, canonicalized JSON arguments digest, and expiration timestamp.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleTestHmacVerification(false)}
                    className="px-3 py-1.5 text-xs font-medium bg-[#16A34A] text-white rounded-md hover:bg-emerald-500 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Verify Authentic Token</span>
                  </button>
                  <button
                    onClick={() => handleTestHmacVerification(true)}
                    className="px-3 py-1.5 text-xs font-medium bg-[#DC2626] text-white rounded-md hover:bg-red-500 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Simulate Argument Tamper
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
      )}
    </div>
  );
}
