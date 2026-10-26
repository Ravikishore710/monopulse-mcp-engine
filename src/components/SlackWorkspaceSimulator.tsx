import React, { useEffect, useState } from 'react';
import { CheckCircle2, Hash, MessageSquare, Play, Send, ShieldAlert, Users } from 'lucide-react';
import { RBACRole } from '../types/monopulse.ts';

interface SlackDummyUser {
  id: string;
  handle: string;
  displayName: string;
  title: string;
  role: RBACRole | 'webhook';
  avatarInitials: string;
  status: 'online' | 'busy' | 'bot';
}

interface SlackWorkspaceData {
  workspaceName: string;
  workspaceDomain: string;
  activeUsersCount: number;
  users: SlackDummyUser[];
  threads: {
    thread_ts: string;
    channel_id: string;
    channel_name: string;
    topic: string;
    messages: { user: string; role: string; ts: string; text: string }[];
    linkedAmbientEvents: {
      eventId: string;
      service: string;
      summary: string;
      rootCauseSynthesis: string;
      approvalState: string;
      approvedByRole?: string;
      approvalToken: string;
      precomputeLatencyMs: number;
    }[];
  }[];
}

interface MultiUserSimulationResult {
  scenarioName: string;
  allStepsPassed: boolean;
  testedEventId: string;
  steps: {
    step: number;
    actor: string;
    role: string;
    action: string;
    expectedBehavior: string;
    actualOutcome: string;
    passed: boolean;
  }[];
  liveExternalConnectors: {
    github: { configured: boolean; reachable: boolean; status: string; detail: string };
    jira: { configured: boolean; reachable: boolean; status: string; detail: string };
  };
}

interface SlackWorkspaceSimulatorProps {
  callerRole: RBACRole;
  onChangeCallerRole?: (role: RBACRole) => void;
  onRefreshSystemState: () => Promise<void>;
}

export function SlackWorkspaceSimulator({
  callerRole,
  onChangeCallerRole,
  onRefreshSystemState
}: SlackWorkspaceSimulatorProps) {
  const [workspace, setWorkspace] = useState<SlackWorkspaceData | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('C04INCIDENTS');
  const [selectedUserHandle, setSelectedUserHandle] = useState<string>('ravi.kishore');
  const [messageText, setMessageText] = useState<string>(
    '[FIRING: P0] Seeing checkout-ledger-svc 5xx errors in us-east-1—can @monopulse-mcp-bot pre-compute root cause?'
  );
  const [autoPrecompute, setAutoPrecompute] = useState<boolean>(true);
  const [posting, setPosting] = useState<boolean>(false);
  const [runningMultiUserSim, setRunningMultiUserSim] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<MultiUserSimulationResult | null>(null);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch('/api/slack/workspace');
      const data: SlackWorkspaceData = await res.json();
      setWorkspace(data);
    } catch {
      // Ignore transient error
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  const handleSelectPersona = (u: SlackDummyUser) => {
    setSelectedUserHandle(u.handle);
    if (u.role !== 'webhook' && onChangeCallerRole) {
      onChangeCallerRole(u.role);
    }
  };

  const handlePostSlackMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    setPosting(true);
    try {
      const res = await fetch('/api/slack/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannelId,
          userHandle: selectedUserHandle,
          text: messageText,
          triggerAmbientPrecompute: autoPrecompute,
          service: selectedChannelId === 'C04SUPPORT_ESC' ? 'webhook-dispatcher-v2' : 'checkout-ledger-svc'
        })
      });
      const data = await res.json();
      if (data.workspace) setWorkspace(data.workspace);
      setMessageText('');
      await onRefreshSystemState();
    } finally {
      setPosting(false);
    }
  };

  const handleRunMultiUserScenario = async () => {
    setRunningMultiUserSim(true);
    try {
      const res = await fetch('/api/slack/simulate-multiuser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      setSimResult(data);
      if (data.workspace) setWorkspace(data.workspace);
      await onRefreshSystemState();
    } finally {
      setRunningMultiUserSim(false);
    }
  };

  if (!workspace) {
    return (
      <div className="border border-[#1F2937] bg-[#111827] p-4 rounded-lg text-xs font-mono text-[#9CA3AF]">
        Loading Dummy Slack Workspace (`monopulse-prod.slack.com`)...
      </div>
    );
  }

  const activeThread =
    workspace.threads.find((t) => t.channel_id === selectedChannelId) || workspace.threads[0];
  const humanUsers = workspace.users.filter((u) => u.role !== 'webhook');

  return (
    <div className="border border-[#2563EB]/50 bg-[#111827] rounded-lg p-5 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#1F2937] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#2563EB]" />
            <h2 className="text-sm font-bold text-[#F9FAFB] font-display">
              Interactive Multi-User Slack Workspace Simulator ({workspace.workspaceDomain})
            </h2>
          </div>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Pre-populated with 6 dummy team personas across 4 RBAC tiers and 3 live incident channels so you can test multi-user Slack workflows without an external Slack workspace.
          </p>
        </div>

        <button
          onClick={handleRunMultiUserScenario}
          disabled={runningMultiUserSim}
          className="px-4 py-2 bg-[#16A34A] hover:bg-green-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          <span>
            {runningMultiUserSim
              ? 'Running 5-User Scenario...'
              : 'Run 5-User Concurrency & Live API Verification'}
          </span>
        </button>
      </div>

      {simResult && (
        <div className="border border-[#16A34A]/60 bg-[#0B0F17] rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-2.5">
            <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[#16A34A]">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {simResult.scenarioName} · {simResult.allStepsPassed ? 'ALL 5 MULTI-USER GATES PASSED' : 'PARTIAL'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#9CA3AF]">
              Event: {simResult.testedEventId} · Active Role: {callerRole}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded border border-[#1F2937] bg-[#111827] flex items-center justify-between">
              <div>
                <div className="text-[#9CA3AF]">GitHub Live API (Ravikishore710)</div>
                <div className="text-[#F9FAFB] text-[11px] mt-0.5">{simResult.liveExternalConnectors.github.detail}</div>
              </div>
              <span className="text-[#16A34A] font-semibold">{simResult.liveExternalConnectors.github.status}</span>
            </div>
            <div className="p-2.5 rounded border border-[#1F2937] bg-[#111827] flex items-center justify-between">
              <div>
                <div className="text-[#9CA3AF]">Atlassian Jira Cloud Live API</div>
                <div className="text-[#F9FAFB] text-[11px] mt-0.5">{simResult.liveExternalConnectors.jira.detail}</div>
              </div>
              <span className="text-[#16A34A] font-semibold">{simResult.liveExternalConnectors.jira.status}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] text-[#9CA3AF] font-mono">
                  <th className="py-1.5 pr-3">Step</th>
                  <th className="py-1.5 pr-3">Slack User</th>
                  <th className="py-1.5 pr-3">RBAC Role</th>
                  <th className="py-1.5 pr-3">Simulated Action</th>
                  <th className="py-1.5 pr-3">Actual Engine Outcome</th>
                  <th className="py-1.5">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]/60 font-mono text-[11px]">
                {simResult.steps.map((s) => (
                  <tr key={s.step}>
                    <td className="py-2 pr-3 text-[#9CA3AF]">#{s.step}</td>
                    <td className="py-2 pr-3 text-[#F9FAFB] font-semibold">{s.actor}</td>
                    <td className="py-2 pr-3 text-[#2563EB]">{s.role}</td>
                    <td className="py-2 pr-3 text-[#9CA3AF] font-sans">{s.action}</td>
                    <td className="py-2 pr-3 text-[#F9FAFB]">{s.actualOutcome}</td>
                    <td className="py-2">
                      <span className={s.passed ? 'text-[#16A34A] font-semibold' : 'text-[#DC2626]'}>
                        {s.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-[#1F2937] bg-[#0B0F17] rounded-md p-3.5 space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase text-[#9CA3AF] mb-2">Slack Channels ({workspace.threads.length})</div>
            <div className="space-y-1">
              {workspace.threads.map((t) => (
                <button
                  key={t.channel_id}
                  onClick={() => setSelectedChannelId(t.channel_id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-xs font-mono transition-colors cursor-pointer ${
                    selectedChannelId === t.channel_id
                      ? 'bg-[#2563EB] text-white font-semibold'
                      : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Hash className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{t.channel_name.replace(/^#/, '')}</span>
                  </span>
                  <span className="text-[11px] opacity-80">{t.messages.length} msgs</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-[#1F2937]">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase text-[#9CA3AF] mb-2">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Switch Active Slack User</span>
              </span>
              <span>RBAC Sync</span>
            </div>
            <div className="space-y-1.5">
              {humanUsers.map((u) => {
                const active = selectedUserHandle === u.handle;
                return (
                  <button
                    key={u.id}
                    onClick={() => handleSelectPersona(u)}
                    className={`w-full text-left p-2 rounded border transition-colors cursor-pointer ${
                      active
                        ? 'border-[#2563EB] bg-[#111827] text-[#F9FAFB]'
                        : 'border-[#1F2937] bg-[#0E131F] text-[#9CA3AF] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-semibold text-[#F9FAFB]">@{u.handle}</span>
                      <span className="text-[10px] text-[#16A34A]">● {u.role}</span>
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] truncate">
                      {u.displayName} · {u.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 border border-[#1F2937] bg-[#0B0F17] rounded-md p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="border-b border-[#1F2937] pb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-mono font-bold text-[#F9FAFB]">{activeThread.channel_name}</div>
                <div className="text-[11px] text-[#9CA3AF]">{activeThread.topic}</div>
              </div>
              <span className="text-[11px] font-mono text-[#2563EB]">
                Posting as @{selectedUserHandle} ({callerRole})
              </span>
            </div>

            <div className="space-y-2.5 max-h-[270px] overflow-y-auto pr-1">
              {activeThread.messages.map((m, idx) => {
                const isBot = m.user.includes('bot') || m.role === 'webhook';
                return (
                  <div
                    key={`${m.ts}-${idx}`}
                    className={`p-3 rounded border text-xs space-y-1 ${
                      isBot
                        ? 'border-[#2563EB]/50 bg-[#111827]'
                        : 'border-[#1F2937] bg-[#0E131F]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#F9FAFB]">@{m.user}</span>
                        <span className="text-[#9CA3AF]">[{m.role}]</span>
                      </div>
                      <span className="text-[#9CA3AF] tabular-nums">ts: {m.ts}</span>
                    </div>
                    <div className="text-[#F9FAFB] leading-relaxed">{m.text}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={handlePostSlackMessage} className="pt-3 border-t border-[#1F2937] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-[#9CA3AF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPrecompute}
                  onChange={(e) => setAutoPrecompute(e.target.checked)}
                  className="rounded border-[#1F2937]"
                />
                <span>Auto-trigger @monopulse-mcp-bot Ambient Pre-Computation &amp; 1-Click Block</span>
              </label>
              <span className="text-[11px] font-mono text-[#9CA3AF] flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-[#2563EB]" />
                Multi-Tab SSE Sync Active
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={`Message ${activeThread.channel_name} as @${selectedUserHandle}...`}
                className="flex-1 bg-[#111827] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
              />
              <button
                type="submit"
                disabled={posting}
                className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{posting ? 'Posting...' : 'Post to Slack'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
