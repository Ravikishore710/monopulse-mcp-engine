import React, { useEffect, useState } from 'react';
import { Hash, Radio, Send, Users } from 'lucide-react';
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

interface SlackWorkspaceSimulatorProps {
  callerRole: RBACRole;
  onChangeCallerRole?: (role: RBACRole) => void;
  onRefreshSystemState: () => Promise<void>;
  onSelectIncident?: (eventId: string) => void;
}

const CHANNEL_BRIDGES: Record<string, { platform: string; endpoint: string }> = {
  C04INCIDENTS: { platform: 'Slack + PagerDuty Bridge', endpoint: 'events.pagerduty.com / #inc-prod-alerts' },
  C08SUPPORT: { platform: 'MS Teams + Jira Service Desk', endpoint: 'teams.webhook.office.com / #tier2-escalations' },
  C09SREWARROOM: { platform: 'Datadog APM + Slack Bridge', endpoint: 'api.datadoghq.com / #sre-war-room' },
  C11DEPLOYMENTS: { platform: 'ArgoCD + GitHub Actions Feed', endpoint: 'argocd.internal / #deployments-feed' }
};

export function SlackWorkspaceSimulator({
  callerRole,
  onChangeCallerRole,
  onRefreshSystemState,
  onSelectIncident
}: SlackWorkspaceSimulatorProps) {
  const [workspace, setWorkspace] = useState<SlackWorkspaceData | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('C04INCIDENTS');
  const [selectedUserHandle, setSelectedUserHandle] = useState<string>('ravi.kishore');
  const [messageText, setMessageText] = useState<string>('');
  const [autoPrecompute, setAutoPrecompute] = useState<boolean>(true);
  const [posting, setPosting] = useState<boolean>(false);

  const fetchWorkspace = async () => {
    try {
      const res = await fetch('/api/slack/workspace');
      const data = await res.json();
      setWorkspace(data);
    } catch {
      // Fallback handled by empty check
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, []);

  if (!workspace) {
    return (
      <div className="border border-[#1F2937] bg-[#111827] rounded-lg p-6 text-xs font-mono text-[#9CA3AF]">
        Connecting to multi-channel incident workspace bridges...
      </div>
    );
  }

  const activeThread =
    workspace.threads.find((t) => t.channel_id === selectedChannelId) || workspace.threads[0];
  const activeUser =
    workspace.users.find((u) => u.handle === selectedUserHandle) || workspace.users[0];
  const bridgeMeta = CHANNEL_BRIDGES[activeThread.channel_id] || {
    platform: 'Custom Webhook Bridge',
    endpoint: 'api.monopulse.internal/bridge'
  };

  const handleSelectUserPersona = (user: SlackDummyUser) => {
    setSelectedUserHandle(user.handle);
    if (user.role !== 'webhook' && onChangeCallerRole) {
      onChangeCallerRole(user.role);
    }
  };

  const handlePostMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    setPosting(true);
    try {
      await fetch('/api/slack/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: activeThread.channel_id,
          userHandle: activeUser.handle,
          text: messageText.trim(),
          triggerAmbientPrecompute: autoPrecompute,
          service:
            activeThread.channel_id === 'C08SUPPORT'
              ? 'webhook-dispatcher-v2'
              : 'checkout-ledger-svc'
        })
      });
      setMessageText('');
      await fetchWorkspace();
      await onRefreshSystemState();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F2937] pb-4">
        <div>
          <h1 className="text-xl font-semibold text-[#F9FAFB] font-display">
            Unified Operations Workspace
          </h1>
          <p className="text-xs text-[#9CA3AF] mt-1">
            Cross-platform incident war rooms synchronizing Slack, Microsoft Teams, PagerDuty, Datadog, and ArgoCD event streams.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
          <Radio className="w-3.5 h-3.5 text-[#16A34A]" />
          <span>4 Connected Channel Bridges</span>
          <span>·</span>
          <span className="font-mono">{workspace.users.length} On-Call Responders</span>
        </div>
      </div>

      <div className="border border-[#1F2937] bg-[#111827] rounded-lg overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[560px]">
          <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-[#1F2937] bg-[#0B0F17] p-4 flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              <div>
                <div className="text-xs font-semibold text-[#9CA3AF] mb-2">
                  Bridged Channels ({workspace.threads.length})
                </div>
                <div className="space-y-1">
                  {workspace.threads.map((t) => {
                    const active = t.channel_id === activeThread.channel_id;
                    const meta = CHANNEL_BRIDGES[t.channel_id];
                    return (
                      <button
                        key={t.channel_id}
                        onClick={() => setSelectedChannelId(t.channel_id)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#2563EB] text-white'
                            : 'text-[#9CA3AF] hover:bg-[#111827] hover:text-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="flex items-center gap-1.5 truncate font-semibold">
                            <Hash className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{t.channel_name.replace('#', '')}</span>
                          </span>
                          <span className="tabular-nums">{t.messages.length}</span>
                        </div>
                        {meta && (
                          <div className={`text-[11px] mt-0.5 truncate ${active ? 'text-blue-100' : 'text-[#9CA3AF]'}`}>
                            {meta.platform}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-[#1F2937]">
                <div className="flex items-center justify-between text-xs font-semibold text-[#9CA3AF] mb-2">
                  <span>Active Operator Persona</span>
                  <Users className="w-3.5 h-3.5" />
                </div>
                <div className="space-y-1.5">
                  {workspace.users
                    .filter((u) => u.role !== 'webhook')
                    .map((u) => {
                      const active = u.handle === activeUser.handle;
                      return (
                        <button
                          key={u.id}
                          onClick={() => handleSelectUserPersona(u)}
                          className={`w-full text-left p-2 rounded-md border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#111827] border-[#2563EB] text-[#F9FAFB]'
                              : 'bg-[#0B0F17] border-[#1F2937] text-[#9CA3AF] hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#F9FAFB] truncate">{u.displayName}</span>
                            <span className="font-mono text-[11px] text-[#2563EB]">{u.role}</span>
                          </div>
                          <div className="text-[11px] text-[#9CA3AF] truncate">
                            @{u.handle} · {u.title}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#1F2937] text-[11px] font-mono text-[#9CA3AF] space-y-1">
              <div>Posting As: @{activeUser.handle}</div>
              <div>RBAC Role: {callerRole}</div>
            </div>
          </div>

          <div className="lg:col-span-9 flex flex-col justify-between bg-[#0E131F]">
            <div className="px-5 py-3.5 border-b border-[#1F2937] bg-[#111827] flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[#F9FAFB] font-mono flex items-center gap-2">
                  <span>{activeThread.channel_name}</span>
                  <span className="text-xs font-normal text-[#9CA3AF]">· {bridgeMeta.platform}</span>
                </div>
                <div className="text-xs text-[#9CA3AF]">{activeThread.topic}</div>
              </div>
              <div className="text-xs font-mono text-[#9CA3AF]">
                {bridgeMeta.endpoint}
              </div>
            </div>

            <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
              {activeThread.messages.map((m, idx) => {
                const userMeta = workspace.users.find((u) => u.handle === m.user);
                return (
                  <div
                    key={`${m.ts}-${idx}`}
                    className="p-3.5 rounded-md bg-[#0B0F17] border border-[#1F2937] space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#F9FAFB]">
                          {userMeta?.displayName || m.user}
                        </span>
                        <span className="font-mono text-[#9CA3AF]">@{m.user}</span>
                        <span className="font-mono text-[#2563EB]">{m.role}</span>
                      </div>
                      <span className="font-mono text-[#9CA3AF] tabular-nums">{m.ts}</span>
                    </div>
                    <p className="text-xs text-[#F9FAFB]/90 leading-relaxed">{m.text}</p>
                  </div>
                );
              })}

              {activeThread.linkedAmbientEvents.length > 0 && (
                <div className="pt-2 space-y-2.5">
                  <div className="text-xs font-mono text-[#9CA3AF]">
                    Pre-Computed Incidents Linked to {activeThread.channel_name}:
                  </div>
                  {activeThread.linkedAmbientEvents.map((evt) => (
                    <div
                      key={evt.eventId}
                      className="p-4 rounded-md bg-[#111827] border border-[#2563EB]/60 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <span className="text-[#F9FAFB] font-semibold">
                          {evt.eventId} · {evt.service}
                        </span>
                        <div className="flex items-center gap-3">
                          <span
                            className={
                              evt.approvalState === 'STAGED_1CLICK_READY'
                                ? 'text-[#D97706]'
                                : 'text-[#16A34A]'
                            }
                          >
                            {evt.approvalState}
                          </span>
                          {onSelectIncident && (
                            <button
                              onClick={() => onSelectIncident(evt.eventId)}
                              className="text-[#2563EB] hover:underline cursor-pointer"
                            >
                              Open in Incidents →
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#9CA3AF]">{evt.rootCauseSynthesis}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={handlePostMessage}
              className="p-4 border-t border-[#1F2937] bg-[#111827] space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                <span>
                  Posting to <strong className="text-[#F9FAFB]">{activeThread.channel_name}</strong> ({bridgeMeta.platform}) as{' '}
                  <strong className="text-[#F9FAFB]">{activeUser.displayName}</strong>
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPrecompute}
                    onChange={(e) => setAutoPrecompute(e.target.checked)}
                    className="rounded border-[#1F2937]"
                  />
                  <span>Auto-trigger incident diagnostics on post</span>
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={`Message ${activeThread.channel_name} as @${activeUser.handle}...`}
                  className="flex-1 bg-[#0B0F17] border border-[#1F2937] rounded-md px-3 py-2 text-xs text-[#F9FAFB]"
                />
                <button
                  type="submit"
                  disabled={posting || !messageText.trim()}
                  className="px-4 py-2 bg-[#2563EB] hover:bg-blue-500 text-white text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{posting ? 'Sending...' : 'Send Message'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
