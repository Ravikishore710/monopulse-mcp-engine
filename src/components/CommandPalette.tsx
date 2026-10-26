import React, { useEffect, useState } from 'react';
import { ActiveModule, MCPToolDefinition, RBACRole } from '../types/monopulse.ts';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  tools: MCPToolDefinition[];
  simulationMode?: boolean;
  onToggleSimulationMode?: (nextState: boolean) => void;
  onSelectModule: (mod: ActiveModule) => void;
  onSelectRole: (role: RBACRole) => void;
  onSelectToolServer: (serverId: string) => void;
  onEmitWebhook: () => void;
}

export function CommandPalette({
  open,
  onClose,
  tools,
  simulationMode = false,
  onToggleSimulationMode,
  onSelectModule,
  onSelectRole,
  onSelectToolServer,
  onEmitWebhook
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
      } else if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleToggleSim = () => {
    if (onToggleSimulationMode) {
      onToggleSimulationMode(!simulationMode);
    }
  };

  const q = query.trim().toLowerCase();
  const staticCommands: {
    id: string;
    category: string;
    label: string;
    action: () => void;
  }[] = [
    {
      id: 'toggle-simulation',
      category: 'Simulation',
      label: `Toggle Simulation Mode (Mock Slack, Jira, GitHub) — Currently: ${simulationMode ? 'ON (Mock Data)' : 'OFF (Live Connectors)'}`,
      action: () => handleToggleSim()
    },
    {
      id: 'page-incidents',
      category: 'Page',
      label: 'Go to Incidents — Active Triage & Remediation Queue',
      action: () => onSelectModule('incidents')
    },
    {
      id: 'page-workspace',
      category: 'Page',
      label: 'Go to Workspace — Team Incident Channels & Threads',
      action: () => onSelectModule('workspace')
    },
    {
      id: 'page-integrations',
      category: 'Page',
      label: 'Go to Integrations — Connected Services & Tool Catalog',
      action: () => onSelectModule('integrations')
    },
    {
      id: 'page-playbooks',
      category: 'Page',
      label: 'Go to Playbooks — Operational Runbooks & Search',
      action: () => onSelectModule('playbooks')
    },
    {
      id: 'page-audit',
      category: 'Page',
      label: 'Go to Audit & Settings — Compliance Ledger, CLI & Sandbox',
      action: () => onSelectModule('audit')
    },
    {
      id: 'act-webhook',
      category: 'Action',
      label: 'Ingest Test Incident Event',
      action: () => onEmitWebhook()
    },
    {
      id: 'role-sre',
      category: 'RBAC Role',
      label: 'Switch Caller Role -> sre_admin (Full Mutations)',
      action: () => onSelectRole('sre_admin')
    },
    {
      id: 'role-ro',
      category: 'RBAC Role',
      label: 'Switch Caller Role -> readonly_analyst (Read-Only)',
      action: () => onSelectRole('readonly_analyst')
    }
  ];

  const toolItems = tools.slice(0, 28).map((t) => ({
    id: `tool-${t.name}`,
    category: `Integration · ${t.serverId}`,
    label: `${t.name} — ${t.description}`,
    action: () => {
      onSelectToolServer(t.serverId);
      onSelectModule('integrations');
    }
  }));

  const filtered = [...staticCommands, ...toolItems]
    .filter((item) => !q || item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
    .slice(0, 12);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="MonoPulse Command Palette"
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl border border-[#1F2937] bg-[#111827] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3.5 border-b border-[#1F2937] flex items-center justify-between gap-2 bg-[#0B0F17]">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length > 0) {
                e.preventDefault();
                filtered[0].action();
                onClose();
              }
            }}
            placeholder="Type a command, Simulation toggle, module, RBAC role, or MCP tool..."
            className="w-full bg-transparent text-xs font-mono text-[#F9FAFB] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-[11px] font-mono border border-[#1F2937] rounded text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer"
          >
            ESC
          </button>
        </div>

        <div className="px-4 py-3 border-b border-[#1F2937] bg-[#0E131F] flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-mono font-semibold text-[#F9FAFB] flex items-center gap-2">
              <span>Simulation Mode (Safe Sandbox Isolation)</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  simulationMode
                    ? 'bg-[#D97706]/20 text-[#D97706] border border-[#D97706]/50'
                    : 'bg-[#16A34A]/20 text-[#16A34A] border border-[#16A34A]/50'
                }`}
              >
                {simulationMode ? 'SIMULATION ON (MOCK DATA)' : 'LIVE CONNECTORS READY'}
              </span>
            </div>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">
              When active, forces mock data for all external MCP connectors (Slack, Jira, GitHub) with zero production side effects.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={simulationMode}
            aria-label="Toggle Simulation Mode"
            onClick={handleToggleSim}
            className={`px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors cursor-pointer shrink-0 ${
              simulationMode
                ? 'bg-[#D97706] text-white hover:bg-amber-500'
                : 'bg-[#1F2937] text-[#F9FAFB] hover:bg-slate-700'
            }`}
          >
            {simulationMode ? 'Disable Simulation' : 'Enable Simulation'}
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-[#1F2937]">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                item.action();
                onClose();
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-[#1F2937]/60 flex items-center justify-between gap-4 text-xs cursor-pointer"
            >
              <span className="text-[#F9FAFB] font-mono truncate">{item.label}</span>
              <span className="text-[11px] font-mono text-[#9CA3AF] shrink-0">{item.category}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
