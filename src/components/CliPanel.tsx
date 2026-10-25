import React, { useState } from 'react';
import { MCPWireFrame, RBACRole } from '../types/monopulse.ts';

interface CliPanelProps {
  wireLog: MCPWireFrame[];
  callerRole: RBACRole;
  onRefreshState: () => Promise<void>;
}

export function CliPanel({ wireLog, callerRole, onRefreshState }: CliPanelProps) {
  const [cliInput, setCliInput] = useState<string>('monopulse mcp list');
  const [wireFilterStatus, setWireFilterStatus] = useState<string>('ALL');
  const [wireSearch, setWireSearch] = useState<string>('');
  const [cliHistory, setCliHistory] = useState<
    { command: string; exitCode: number; output: string; timestamp: string }[]
  >([
    {
      command: 'monopulse help',
      exitCode: 0,
      timestamp: '15:22:00 UTC',
      output: `MonoPulse Operations Engine CLI (v3.7.0-MCP)
Type or click a preset command below to execute directly against the backend JSON-RPC & webhook bus:
  monopulse mcp list                           List all 6 custom MCP servers and 28 deterministic tools
  monopulse rbac test-unauthorized             Verify protocol-level RBAC & SQL DML rejection
  monopulse webhook emit ledger                Trigger background pre-computation & stage 1-Click Approval
  monopulse memory search "PgBouncer lock"     Run Hybrid RRF + pgvector cosine similarity search
  monopulse kaggle distill evt-ambient-901     Offload trajectory distillation to Kaggle GPU bridge`
    }
  ]);
  const [runningCli, setRunningCli] = useState(false);

  const handleRunCliCommand = async (cmdOverride?: string) => {
    const cmd = (cmdOverride ?? cliInput).trim();
    if (!cmd) return;
    setRunningCli(true);
    if (cmdOverride) setCliInput(cmdOverride);
    try {
      const res = await fetch('/api/cli/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, callerRole })
      });
      const data = await res.json();
      setCliHistory((prev) => [
        {
          command: cmd,
          exitCode: data.exitCode ?? 0,
          output: data.output || '',
          timestamp: new Date().toISOString().slice(11, 19) + ' UTC'
        },
        ...prev
      ]);
      await onRefreshState();
    } finally {
      setRunningCli(false);
    }
  };

  const filteredWireLog = wireLog.filter((wf) => {
    if (wireFilterStatus !== 'ALL' && wf.status !== wireFilterStatus) return false;
    if (
      wireSearch.trim() &&
      !`${wf.toolName} ${wf.serverId} ${wf.callerRole} ${wf.frameId}`
        .toLowerCase()
        .includes(wireSearch.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1F2937] pb-4">
        <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
          04. Live CLI Harness &amp; JSON-RPC 2.0 Wire Frame Inspector
        </h1>
        <p className="text-xs text-[#9CA3AF] mt-1">
          Execute headless MonoPulse CLI commands against the backend engine and filter raw JSON-RPC 2.0 protocol frames.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#9CA3AF]">Quick CLI Commands:</span>
            {[
              'monopulse mcp list',
              'monopulse rbac test-unauthorized',
              'monopulse webhook emit ledger',
              'monopulse memory search "PgBouncer lock"',
              'monopulse kaggle distill evt-ambient-901'
            ].map((preset) => (
              <button
                key={preset}
                onClick={() => handleRunCliCommand(preset)}
                className="px-2.5 py-1 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#2563EB] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
              >
                {preset}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunCliCommand();
            }}
            className="flex gap-2"
          >
            <div className="flex-1 flex items-center bg-[#0B0F17] border border-[#1F2937] rounded-md px-3">
              <span className="text-xs font-mono text-[#2563EB] mr-2">$</span>
              <input
                type="text"
                value={cliInput}
                onChange={(e) => setCliInput(e.target.value)}
                className="w-full py-2 bg-transparent font-mono text-xs text-[#F9FAFB] focus:outline-none"
                placeholder="monopulse mcp call sql_inspect_table_schema '{&quot;table_name&quot;:&quot;deployments&quot;}'"
              />
            </div>
            <button
              type="submit"
              disabled={runningCli}
              className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap"
            >
              {runningCli ? 'Running...' : 'Execute'}
            </button>
          </form>

          <div className="space-y-3 max-h-[520px] overflow-y-auto">
            {cliHistory.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded border border-[#1F2937] bg-[#0B0F17] font-mono text-xs space-y-2"
              >
                <div className="flex items-center justify-between text-[#9CA3AF]">
                  <span className="text-[#F9FAFB] font-semibold">$ {item.command}</span>
                  <span className="tabular-nums">
                    exit={item.exitCode} · {item.timestamp}
                  </span>
                </div>
                <pre className="text-[11px] text-[#9CA3AF] whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {item.output}
                </pre>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F9FAFB]">
              JSON-RPC 2.0 Protocol Wire Frames ({filteredWireLog.length}/{wireLog.length})
            </h2>
            <span className="text-xs font-mono text-[#9CA3AF]">stdio/http-rpc</span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={wireSearch}
              onChange={(e) => setWireSearch(e.target.value)}
              placeholder="Filter by tool, server, or role..."
              className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded px-2.5 py-1.5 text-xs font-mono text-[#F9FAFB] focus:outline-none"
            />
            <select
              aria-label="Filter wire frames by status"
              value={wireFilterStatus}
              onChange={(e) => setWireFilterStatus(e.target.value)}
              className="bg-[#0B0F17] border border-[#1F2937] rounded px-2.5 py-1.5 text-xs font-mono text-[#F9FAFB]"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="RBAC_DENIED">RBAC_DENIED</option>
              <option value="SQL_MUTATION_BLOCKED">SQL_MUTATION_BLOCKED</option>
              <option value="SCHEMA_INVALID">SCHEMA_INVALID</option>
            </select>
          </div>

          {filteredWireLog.length === 0 ? (
            <div className="p-6 border border-[#1F2937] bg-[#0B0F17] rounded text-center space-y-2">
              <p className="text-xs text-[#9CA3AF]">No MCP wire frames match the current filter.</p>
              <button
                onClick={() => handleRunCliCommand('monopulse rbac test-unauthorized')}
                className="px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded cursor-pointer"
              >
                Generate Sample Wire Frames
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto">
              {filteredWireLog.map((wf) => (
                <div
                  key={wf.frameId}
                  className="p-3 rounded border border-[#1F2937] bg-[#0B0F17] text-xs font-mono space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[#F9FAFB] font-semibold">{wf.toolName}</span>
                    <span
                      className={wf.status === 'SUCCESS' ? 'text-[#16A34A]' : 'text-[#DC2626]'}
                    >
                      {wf.status} · {wf.latencyMs}ms
                    </span>
                  </div>
                  <div className="text-[11px] text-[#9CA3AF]">
                    {wf.serverId} · role={wf.callerRole} · {wf.frameId}
                  </div>
                  <pre className="p-2 bg-[#111827] rounded text-[11px] text-[#9CA3AF] overflow-x-auto">
                    {JSON.stringify({ req: wf.requestPayload, res: wf.responsePayload }, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
