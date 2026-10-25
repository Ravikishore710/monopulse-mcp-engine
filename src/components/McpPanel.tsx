import React, { useState } from 'react';
import { Play, Search } from 'lucide-react';
import {
  DEFAULT_TOOL_ARGS,
  MCPServerMetadata,
  MCPToolDefinition,
  RBACRole
} from '../types/monopulse.ts';

interface McpPanelProps {
  servers: MCPServerMetadata[];
  tools: MCPToolDefinition[];
  callerRole: RBACRole;
  onChangeCallerRole: (role: RBACRole) => void;
  selectedServerFilter: string;
  onSelectServerFilter: (serverId: string) => void;
  onRefreshState: () => Promise<void>;
}

export function McpPanel({
  servers,
  tools,
  callerRole,
  onChangeCallerRole,
  selectedServerFilter,
  onSelectServerFilter,
  onRefreshState
}: McpPanelProps) {
  const [toolSearchQuery, setToolSearchQuery] = useState<string>('');
  const [selectedToolName, setSelectedToolName] = useState<string>('sql_execute_readonly_query');
  const [rpcArgsText, setRpcArgsText] = useState<string>(
    JSON.stringify(DEFAULT_TOOL_ARGS['sql_execute_readonly_query'], null, 2)
  );
  const [rpcResponse, setRpcResponse] = useState<any>(null);
  const [executingRpc, setExecutingRpc] = useState(false);

  const selectedTool = tools.find((t) => t.name === selectedToolName) || tools[0];
  const filteredTools = tools.filter((t) => {
    const matchesServer = selectedServerFilter === 'all' || t.serverId === selectedServerFilter;
    const matchesSearch =
      !toolSearchQuery ||
      t.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(toolSearchQuery.toLowerCase());
    return matchesServer && matchesSearch;
  });

  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    setRpcArgsText(JSON.stringify(DEFAULT_TOOL_ARGS[toolName] || {}, null, 2));
    setRpcResponse(null);
  };

  const handleDispatchMCPTool = async (
    customTool?: string,
    customArgs?: Record<string, any>,
    customRole?: RBACRole
  ) => {
    setExecutingRpc(true);
    const toolToCall = customTool || selectedToolName;
    const roleToUse = customRole || callerRole;
    let parsedArgs: any = customArgs;

    if (!parsedArgs) {
      try {
        parsedArgs = JSON.parse(rpcArgsText);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid JSON';
        setRpcResponse({
          status: 'JSON_PARSE_ERROR',
          httpCode: 400,
          error: { message: `Client JSON Syntax Error: ${msg}` }
        });
        setExecutingRpc(false);
        return;
      }
    } else {
      setSelectedToolName(toolToCall);
      setRpcArgsText(JSON.stringify(parsedArgs, null, 2));
      if (customRole) onChangeCallerRole(customRole);
    }

    try {
      const res = await fetch('/api/mcp/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolToCall,
            arguments: parsedArgs,
            callerRole: roleToUse
          }
        })
      });
      const data = await res.json();
      setRpcResponse(data);
      await onRefreshState();
    } finally {
      setExecutingRpc(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F9FAFB] font-display">
            02. MCP Tool Surface &amp; Protocol Security Boundary (6 Servers · 28 Tools)
          </h1>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Every tool call is validated against strict Draft-07 JSON Schema, granular RBAC role policies, and read-only SQL AST guards before execution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg">
          <button
            onClick={() => onSelectServerFilter('all')}
            className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
              selectedServerFilter === 'all'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
            }`}
          >
            All (28)
          </button>
          {servers.map((srv) => (
            <button
              key={srv.id}
              onClick={() => onSelectServerFilter(srv.id)}
              className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                selectedServerFilter === srv.id
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              {srv.id.replace('-mcp', '')} ({srv.toolCount})
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-lg p-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-2.5" />
            <input
              type="text"
              value={toolSearchQuery}
              onChange={(e) => setToolSearchQuery(e.target.value)}
              placeholder="Filter 28 tools by name or description..."
              className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md pl-9 pr-3 py-2 text-xs text-[#F9FAFB]"
            />
          </div>

          <div className="max-h-[600px] overflow-y-auto divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
            {filteredTools.map((tool) => {
              const active = tool.name === selectedTool.name;
              const callerPermitted = tool.allowedRoles.includes(callerRole);
              return (
                <button
                  key={tool.name}
                  onClick={() => handleSelectTool(tool.name)}
                  className={`w-full text-left p-3 transition-colors cursor-pointer block ${
                    active ? 'bg-[#111827]' : 'hover:bg-[#111827]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span className={active ? 'text-[#2563EB] font-semibold' : 'text-[#F9FAFB]'}>
                      {tool.name}
                    </span>
                    <span className={tool.isMutation ? 'text-[#D97706]' : 'text-[#9CA3AF]'}>
                      {tool.isMutation ? 'MUTATION' : 'READ-ONLY'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#9CA3AF] mt-1 line-clamp-1">
                    {tool.description}
                  </div>
                  <div className="text-[11px] font-mono text-[#9CA3AF] mt-1.5 flex items-center justify-between">
                    <span>{tool.serverId}</span>
                    <span className={callerPermitted ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                      {callerPermitted ? `RBAC: ${callerRole} OK` : `RBAC: Denied for ${callerRole}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-lg p-6 space-y-5">
          <div className="border-b border-[#1F2937] pb-4 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div>
                <span className="text-[#2563EB] font-semibold">{selectedTool.serverId}</span>
                <span className="mx-2 text-[#9CA3AF]">·</span>
                <span className="text-[#F9FAFB] font-semibold">{selectedTool.name}</span>
              </div>
              <span className={selectedTool.isMutation ? 'text-[#D97706]' : 'text-[#16A34A]'}>
                {selectedTool.isMutation ? 'MUTATION_GATE_ACTIVE' : 'DETERMINISTIC_READ_ONLY'}
              </span>
            </div>
            <p className="text-xs text-[#9CA3AF]">{selectedTool.description}</p>
            <div className="text-xs font-mono text-[#9CA3AF] pt-1">
              Permitted RBAC Roles: {selectedTool.allowedRoles.join(' · ')}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#9CA3AF]">
              1-Click Boundary Enforcement Verification Presets:
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  handleDispatchMCPTool(
                    'sql_execute_readonly_query',
                    DEFAULT_TOOL_ARGS['sql_execute_readonly_query'],
                    'readonly_analyst'
                  )
                }
                className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#16A34A] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
              >
                1. Valid Read-Only SQL
              </button>
              <button
                onClick={() =>
                  handleDispatchMCPTool(
                    'infra_trigger_canary_rollback',
                    { deploy_id: 'dep-9042', reason: 'Attempted rollback by analyst' },
                    'readonly_analyst'
                  )
                }
                className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#DC2626] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
              >
                2. Test RBAC Violation (403)
              </button>
              <button
                onClick={() =>
                  handleDispatchMCPTool(
                    'sql_execute_readonly_query',
                    { query: 'SELECT * FROM deployments', row_limit: 9999, injected_field: true },
                    'sre_admin'
                  )
                }
                className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#D97706] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
              >
                3. Test JSON Schema Violation (-32602)
              </button>
              <button
                onClick={() =>
                  handleDispatchMCPTool(
                    'sql_execute_readonly_query',
                    { query: 'DROP TABLE deployments; --' },
                    'sre_admin'
                  )
                }
                className="px-3 py-1.5 text-xs font-mono border border-[#1F2937] bg-[#0B0F17] hover:border-[#DC2626] text-[#F9FAFB] rounded cursor-pointer whitespace-nowrap"
              >
                4. Test SQL DML/DDL Block
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-[#9CA3AF] mb-1.5">
                Enforced JSON Schema (Draft-07)
              </div>
              <pre className="p-3 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] overflow-x-auto h-52">
                {JSON.stringify(selectedTool.inputSchema, null, 2)}
              </pre>
            </div>

            <div className="flex flex-col">
              <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF] mb-1.5">
                <span>JSON-RPC 2.0 Call Arguments</span>
                <span className="font-mono text-[#F9FAFB]">Role: {callerRole}</span>
              </div>
              <textarea
                value={rpcArgsText}
                onChange={(e) => setRpcArgsText(e.target.value)}
                className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded p-3 font-mono text-xs text-[#F9FAFB] h-52"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs font-mono text-[#9CA3AF]">
              POST /api/mcp/rpc · method=&quot;tools/call&quot;
            </div>
            <button
              onClick={() => handleDispatchMCPTool()}
              disabled={executingRpc}
              className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{executingRpc ? 'Executing RPC...' : `Invoke ${selectedTool.name}`}</span>
            </button>
          </div>

          {rpcResponse && (
            <div className="space-y-1.5 pt-2 border-t border-[#1F2937]">
              <div className="flex items-center justify-between text-xs font-mono">
                <span
                  className={
                    rpcResponse.status === 'SUCCESS'
                      ? 'text-[#16A34A] font-semibold'
                      : 'text-[#DC2626] font-semibold'
                  }
                >
                  BOUNDARY STATUS: {rpcResponse.status} (HTTP {rpcResponse.httpCode})
                </span>
                {rpcResponse.wireFrame && (
                  <span className="tabular-nums text-[#9CA3AF]">
                    Latency: {rpcResponse.wireFrame.latencyMs}ms
                  </span>
                )}
              </div>
              <pre className="p-3.5 rounded bg-[#0B0F17] border border-[#1F2937] text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-64">
                {JSON.stringify(rpcResponse.result || rpcResponse.error, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
