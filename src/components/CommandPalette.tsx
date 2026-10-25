import React, { useEffect, useState } from 'react';
import { ActiveModule, MCPToolDefinition, RBACRole } from '../types/monopulse.ts';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  tools: MCPToolDefinition[];
  onSelectModule: (mod: ActiveModule) => void;
  onSelectRole: (role: RBACRole) => void;
  onSelectToolServer: (serverId: string) => void;
  onEmitWebhook: () => void;
}

export function CommandPalette({
  open,
  onClose,
  tools,
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

  const q = query.trim().toLowerCase();
  const staticCommands: {
    id: string;
    category: string;
    label: string;
    action: () => void;
  }[] = [
    {
      id: 'mod-ambient',
      category: 'Module',
      label: 'Go to 01. Ambient Event Bus & 1-Click Approvals',
      action: () => onSelectModule('ambient')
    },
    {
      id: 'mod-mcp',
      category: 'Module',
      label: 'Go to 02. MCP Tool Boundary & RBAC Gatekeeper',
      action: () => onSelectModule('mcp')
    },
    {
      id: 'mod-memory',
      category: 'Module',
      label: 'Go to 03. Hybrid Memory & Kaggle GPU Distiller',
      action: () => onSelectModule('memory')
    },
    {
      id: 'mod-cli',
      category: 'Module',
      label: 'Go to 04. Live CLI Harness & Wire Protocol Log',
      action: () => onSelectModule('cli')
    },
    {
      id: 'mod-audit',
      category: 'Module',
      label: 'Go to 05. SQLite, Hash-Chain & Crypto Audit',
      action: () => onSelectModule('audit')
    },
    {
      id: 'act-webhook',
      category: 'Action',
      label: 'Emit Incident Webhook (Pre-Compute Read-Only Trace)',
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
      label: 'Switch Caller Role -> readonly_analyst (Zero Mutations)',
      action: () => onSelectRole('readonly_analyst')
    }
  ];

  const toolItems = tools.slice(0, 28).map((t) => ({
    id: `tool-${t.name}`,
    category: `MCP · ${t.serverId}`,
    label: `${t.name} — ${t.description}`,
    action: () => {
      onSelectToolServer(t.serverId);
      onSelectModule('mcp');
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
            placeholder="Type a command, module, RBAC role, or MCP tool name..."
            className="w-full bg-transparent text-xs font-mono text-[#F9FAFB] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-[11px] font-mono border border-[#1F2937] rounded text-[#9CA3AF] hover:text-[#F9FAFB] cursor-pointer"
          >
            ESC
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
