import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Play, Plus, Radio, Search, Sliders, Trash2, Zap } from 'lucide-react';
import { DEFAULT_TOOL_ARGS, MCPServerMetadata, MCPToolDefinition, RBACRole } from '../types/monopulse.ts';

interface CustomIntegrationItem {
  id: string;
  name: string;
  provider: string;
  category: string;
  protocol: string;
  endpointUrl: string;
  status: 'CONNECTED' | 'SANDBOX_SIMULATED' | 'PAUSED';
  authMethod: string;
  subscribedEvents: string[];
  mappedService: 'checkout-ledger-svc' | 'webhook-dispatcher-v2';
  toolsCount: number;
  lastVerifiedAt: string;
  lastLatencyMs: number;
  isBuiltIn: boolean;
}

interface McpPanelProps {
  servers: MCPServerMetadata[];
  tools: MCPToolDefinition[];
  callerRole: RBACRole;
  onChangeCallerRole: (role: RBACRole) => void;
  selectedServerFilter: string;
  onSelectServerFilter: (serverId: string) => void;
  onRefreshState: () => Promise<void>;
  onNavigateToIncident?: (eventId: string) => void;
}

const CATEGORIES = [
  'All',
  'Observability & APM',
  'Incident & On-Call',
  'Ticketing & Project',
  'Messaging & Chat',
  'Cloud & Kubernetes',
  'Custom Webhook / MCP'
];

export function McpPanel({
  servers,
  tools,
  callerRole,
  onChangeCallerRole,
  selectedServerFilter,
  onSelectServerFilter,
  onRefreshState,
  onNavigateToIncident
}: McpPanelProps) {
  const [activeView, setActiveView] = useState<'connectors' | 'tools'>('connectors');
  const [integrations, setIntegrations] = useState<CustomIntegrationItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [expandedConnectorIds, setExpandedConnectorIds] = useState<Record<string, boolean>>({});
  const [showSchemaDetail, setShowSchemaDetail] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newIntName, setNewIntName] = useState<string>('');
  const [newIntProvider, setNewIntProvider] = useState<string>('');
  const [newIntCategory, setNewIntCategory] = useState<string>('Observability & APM');
  const [newIntProtocol, setNewIntProtocol] = useState<string>('REST Webhook (HMAC-SHA256)');
  const [newIntEndpoint, setNewIntEndpoint] = useState<string>('https://events.custom-ops.io/v1/webhook');
  const [newIntService, setNewIntService] = useState<'checkout-ledger-svc' | 'webhook-dispatcher-v2'>('checkout-ledger-svc');
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const [toolSearchQuery, setToolSearchQuery] = useState<string>('');
  const [selectedToolName, setSelectedToolName] = useState<string>('sql_execute_readonly_query');
  const [rpcArgsText, setRpcArgsText] = useState<string>(JSON.stringify(DEFAULT_TOOL_ARGS['sql_execute_readonly_query'], null, 2));
  const [rpcResponse, setRpcResponse] = useState<any>(null);
  const [executingRpc, setExecutingRpc] = useState(false);

  const loadIntegrations = async () => {
    try {
      const res = await fetch('/api/integrations');
      const data = await res.json();
      if (Array.isArray(data.integrations)) setIntegrations(data.integrations);
    } catch (err: unknown) {
      setActionBanner(err instanceof Error ? err.message : 'Unable to load integrations');
    }
  };

  useEffect(() => { loadIntegrations(); }, []);

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIntName.trim()) return;
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newIntName.trim(),
        provider: newIntProvider.trim() || newIntName.trim(),
        category: newIntCategory,
        protocol: newIntProtocol,
        endpointUrl: newIntEndpoint.trim(),
        authMethod: 'HMAC-SHA256 Secret',
        mappedService: newIntService
      })
    });
    if (res.ok) {
      setNewIntName('');
      setNewIntProvider('');
      setShowAddModal(false);
      setActionBanner(`Registered custom integration '${newIntName.trim()}'`);
      await loadIntegrations();
    }
  };

  const handleTestIntegration = async (id: string) => {
    const res = await fetch(`/api/integrations/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setActionBanner(`Verified ${data.name} (${data.protocol}) · ${data.latencyMs}ms · Signature OK`);
      await loadIntegrations();
    }
  };

  const handleTriggerIntegrationIncident = async (id: string) => {
    const res = await fetch(`/api/integrations/${id}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok && data.event?.eventId) {
      await onRefreshState();
      setActionBanner(`Ingested incident ${data.event.eventId} from ${data.integration.name}`);
      if (onNavigateToIncident) onNavigateToIncident(data.event.eventId);
    }
  };

  const handleDeleteIntegration = async (id: string) => {
    await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
    await loadIntegrations();
  };

  const selectedTool = tools.find((t) => t.name === selectedToolName) || tools[0];
  const filteredTools = tools.filter((t) => {
    const matchesServer = selectedServerFilter === 'all' || t.serverId === selectedServerFilter;
    const matchesSearch = !toolSearchQuery || t.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) || t.description.toLowerCase().includes(toolSearchQuery.toLowerCase());
    return matchesServer && matchesSearch;
  });

  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    setRpcArgsText(JSON.stringify(DEFAULT_TOOL_ARGS[toolName] || {}, null, 2));
    setRpcResponse(null);
  };

  const handleDispatchMCPTool = async (customTool?: string, customArgs?: Record<string, any>, customRole?: RBACRole) => {
    setExecutingRpc(true);
    const toolToCall = customTool || selectedToolName;
    const roleToUse = customRole || callerRole;
    let parsedArgs: any = customArgs;

    if (!parsedArgs) {
      try {
        parsedArgs = JSON.parse(rpcArgsText);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid JSON';
        setRpcResponse({ status: 'JSON_PARSE_ERROR', httpCode: 400, error: { message: `JSON Syntax Error: ${msg}` } });
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
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolToCall, arguments: parsedArgs, callerRole: roleToUse } })
      });
      setRpcResponse(await res.json());
      await onRefreshState();
    } finally {
      setExecutingRpc(false);
    }
  };

  const visibleIntegrations = integrations.filter((i) => categoryFilter === 'All' || i.category === categoryFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#F9FAFB] font-display">Integrations &amp; Custom Connector Hub</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            Connect observability, on-call, ticketing, chat, cloud deployment, and custom webhook or MCP providers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg">
            <button onClick={() => setActiveView('connectors')} className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer flex items-center gap-1.5 ${activeView === 'connectors' ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>
              <Radio className="w-3.5 h-3.5" /><span>Connected Platforms ({integrations.length})</span>
            </button>
            <button onClick={() => setActiveView('tools')} className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer flex items-center gap-1.5 ${activeView === 'tools' ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>
              <Sliders className="w-3.5 h-3.5" /><span>MCP Tool Catalog ({tools.length})</span>
            </button>
          </div>
          <button onClick={() => { setActiveView('connectors'); setShowAddModal((prev) => !prev); }} className="px-3.5 py-2 text-xs font-medium bg-[#2563EB] hover:bg-blue-500 text-white rounded-md cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /><span>Add Custom Integration</span>
          </button>
        </div>
      </div>

      {actionBanner && (
        <div className="px-4 py-2.5 rounded-md border border-[#16A34A]/40 bg-[#16A34A]/10 text-xs text-[#F9FAFB] flex items-center justify-between">
          <span className="font-mono">{actionBanner}</span>
          <button onClick={() => setActionBanner(null)} className="text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer">Dismiss</button>
        </div>
      )}

      {activeView === 'connectors' && (
        <div className="space-y-5">
          {showAddModal && (
            <form onSubmit={handleCreateIntegration} className="border border-[#2563EB]/50 bg-[#111827] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#F9FAFB]">Register Custom Integration or Webhook Bridge</h2>
                  <p className="text-xs text-[#9CA3AF]">Connect any external REST webhook, OpenTelemetry collector, GraphQL endpoint, or custom MCP server.</p>
                </div>
                <button type="button" onClick={() => setShowAddModal(false)} className="text-xs text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer">Cancel</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input type="text" required value={newIntName} onChange={(e) => setNewIntName(e.target.value)} placeholder="Integration Name (e.g. Grafana OnCall)" className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]" />
                <input type="text" value={newIntProvider} onChange={(e) => setNewIntProvider(e.target.value)} placeholder="Vendor (e.g. Grafana Labs / AWS)" className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]" />
                <select value={newIntCategory} onChange={(e) => setNewIntCategory(e.target.value)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]">
                  {CATEGORIES.filter((c) => c !== 'All').map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
                <select value={newIntProtocol} onChange={(e) => setNewIntProtocol(e.target.value)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]">
                  <option value="REST Webhook (HMAC-SHA256)">REST Webhook (HMAC-SHA256)</option>
                  <option value="MCP JSON-RPC 2.0">MCP JSON-RPC 2.0</option>
                  <option value="OpenTelemetry OTLP">OpenTelemetry OTLP</option>
                  <option value="GraphQL API">GraphQL API</option>
                </select>
                <input type="url" required value={newIntEndpoint} onChange={(e) => setNewIntEndpoint(e.target.value)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs font-mono text-[#F9FAFB]" />
                <select value={newIntService} onChange={(e) => setNewIntService(e.target.value as any)} className="bg-[#0B0F17] border border-[#1F2937] rounded px-3 py-2 text-xs text-[#F9FAFB]">
                  <option value="checkout-ledger-svc">checkout-ledger-svc</option>
                  <option value="webhook-dispatcher-v2">webhook-dispatcher-v2</option>
                </select>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 text-xs font-medium bg-[#2563EB] hover:bg-blue-500 text-white rounded-md cursor-pointer">Save &amp; Connect Integration</button>
              </div>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg w-fit">
            {CATEGORIES.map((cat) => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer whitespace-nowrap ${categoryFilter === cat ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>{cat}</button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleIntegrations.map((item) => {
              const isExpanded = Boolean(expandedConnectorIds[item.id]);
              return (
                <div key={item.id} className="border border-[#1F2937] bg-[#111827] rounded-xl p-5 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-[#9CA3AF]">{item.provider} · {item.category}</div>
                        <h3 className="text-sm font-semibold text-[#F9FAFB] mt-0.5">{item.name}</h3>
                      </div>
                      <span className="text-xs font-mono font-medium text-[#16A34A] shrink-0">{item.status}</span>
                    </div>
                    <p className="text-xs text-[#F9FAFB]/85 leading-relaxed">
                      Routes {item.category.toLowerCase()} signals into <span className="font-mono text-[#F9FAFB]">{item.mappedService}</span> ({item.lastLatencyMs}ms p95).
                    </p>
                    <button type="button" onClick={() => setExpandedConnectorIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))} className="text-[11px] font-mono text-[#9CA3AF] hover:text-[#F9FAFB] flex items-center gap-1 cursor-pointer pt-0.5">
                      <span>{isExpanded ? 'Hide Technical Details' : 'View Technical Details'}</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {isExpanded && (
                      <div className="p-2.5 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] space-y-1">
                        <div className="truncate">Endpoint: {item.endpointUrl}</div>
                        <div>Protocol: {item.protocol} · Auth: {item.authMethod}</div>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[#1F2937] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleTestIntegration(item.id)} className="px-2.5 py-1.5 text-xs font-medium border border-[#1F2937] bg-[#0B0F17] text-[#F9FAFB] hover:border-slate-600 rounded cursor-pointer flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" /><span>Verify</span>
                      </button>
                      <button onClick={() => handleTriggerIntegrationIncident(item.id)} className="px-2.5 py-1.5 text-xs font-medium bg-[#2563EB]/15 text-[#2563EB] hover:bg-[#2563EB] hover:text-white rounded cursor-pointer flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" /><span>Simulate Alert</span>
                      </button>
                    </div>
                    {!item.isBuiltIn && (
                      <button onClick={() => handleDeleteIntegration(item.id)} aria-label={`Remove ${item.name}`} className="p-1.5 text-[#9CA3AF] hover:text-[#DC2626] cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === 'tools' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111827] border border-[#1F2937] rounded-lg w-fit">
            <button onClick={() => onSelectServerFilter('all')} className={`px-2.5 py-1.5 text-xs font-mono rounded cursor-pointer ${selectedServerFilter === 'all' ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>All ({tools.length})</button>
            {servers.map((srv) => (
              <button key={srv.id} onClick={() => onSelectServerFilter(srv.id)} className={`px-2.5 py-1.5 text-xs font-mono rounded cursor-pointer ${selectedServerFilter === srv.id ? 'bg-[#2563EB] text-white' : 'text-[#9CA3AF] hover:text-[#F9FAFB]'}`}>
                {srv.id.replace('-mcp', '')} ({srv.toolCount})
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-5 border border-[#1F2937] bg-[#111827] rounded-xl p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-2.5" />
                <input type="text" value={toolSearchQuery} onChange={(e) => setToolSearchQuery(e.target.value)} placeholder="Filter 28 tools by name or description..." className="w-full bg-[#0B0F17] border border-[#1F2937] rounded-md pl-9 pr-3 py-2 text-xs text-[#F9FAFB]" />
              </div>
              <div className="max-h-[520px] overflow-y-auto divide-y divide-[#1F2937] border border-[#1F2937] rounded-md bg-[#0B0F17]">
                {filteredTools.map((tool) => {
                  const active = tool.name === selectedTool.name;
                  const callerPermitted = tool.allowedRoles.includes(callerRole);
                  return (
                    <button key={tool.name} onClick={() => handleSelectTool(tool.name)} className={`w-full text-left p-3 transition-colors cursor-pointer block ${active ? 'bg-[#111827]' : 'hover:bg-[#111827]/60'}`}>
                      <div className="flex items-center justify-between gap-2 text-xs font-mono">
                        <span className={active ? 'text-[#2563EB] font-medium' : 'text-[#F9FAFB]'}>{tool.name}</span>
                        <span className={tool.isMutation ? 'text-[#D97706]' : 'text-[#9CA3AF]'}>{tool.isMutation ? 'MUTATION' : 'READ-ONLY'}</span>
                      </div>
                      <div className="text-[11px] text-[#9CA3AF] mt-1 line-clamp-1">{tool.description}</div>
                      <div className="text-[11px] font-mono text-[#9CA3AF] mt-1.5 flex items-center justify-between">
                        <span>{tool.serverId}</span>
                        <span className={callerPermitted ? 'text-[#16A34A]' : 'text-[#DC2626]'}>{callerPermitted ? `Role ${callerRole}: Permitted` : `Role ${callerRole}: Denied`}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="xl:col-span-7 border border-[#1F2937] bg-[#111827] rounded-xl p-6 space-y-5">
              <div className="border-b border-[#1F2937] pb-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span>{selectedTool.serverId} · <strong className="text-[#F9FAFB]">{selectedTool.name}</strong></span>
                  <span className={selectedTool.isMutation ? 'text-[#D97706]' : 'text-[#16A34A]'}>{selectedTool.isMutation ? 'MUTATION_GATE_ACTIVE' : 'READ_ONLY'}</span>
                </div>
                <p className="text-xs text-[#F9FAFB]/90 leading-relaxed">{selectedTool.description}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#9CA3AF]">
                  <span>Allowed Roles: {selectedTool.allowedRoles.join(' · ')}</span>
                  <button type="button" onClick={() => setShowSchemaDetail((prev) => !prev)} className="text-[#2563EB] hover:underline cursor-pointer">
                    {showSchemaDetail ? 'Hide Input JSON Schema (Draft-07)' : 'View Input JSON Schema (Draft-07)'}
                  </button>
                </div>
              </div>

              {showSchemaDetail && (
                <div>
                  <div className="text-xs font-medium text-[#9CA3AF] mb-1.5">Input JSON Schema (Draft-07)</div>
                  <pre className="p-3 rounded bg-[#0B0F17] border border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] overflow-x-auto max-h-48">{JSON.stringify(selectedTool.inputSchema, null, 2)}</pre>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-[#9CA3AF]">
                  <span>JSON-RPC 2.0 Arguments</span><span className="font-mono text-[#F9FAFB]">Role: {callerRole}</span>
                </div>
                <textarea value={rpcArgsText} onChange={(e) => setRpcArgsText(e.target.value)} rows={5} className="w-full bg-[#0B0F17] border border-[#1F2937] rounded p-3 font-mono text-xs text-[#F9FAFB]" />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-mono text-[#9CA3AF]">POST /api/mcp/rpc</span>
                <button onClick={() => handleDispatchMCPTool()} disabled={executingRpc} className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-medium rounded-md flex items-center gap-2 cursor-pointer">
                  <Play className="w-3.5 h-3.5" /><span>{executingRpc ? 'Executing...' : `Invoke ${selectedTool.name}`}</span>
                </button>
              </div>

              {rpcResponse && (
                <pre className="p-3.5 rounded bg-[#0B0F17] border border-[#1F2937] text-xs font-mono text-[#F9FAFB] overflow-x-auto max-h-60">
                  {JSON.stringify(rpcResponse.result || rpcResponse.error, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
