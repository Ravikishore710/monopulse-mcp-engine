// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { CliPanel } from '../src/components/CliPanel.tsx';
import { KaggleGpuDashboard } from '../src/components/KaggleGpuDashboard.tsx';
import { CommandPalette } from '../src/components/CommandPalette.tsx';
import { AmbientPanel } from '../src/components/AmbientPanel.tsx';
import App from '../src/App.tsx';

function CrashingChild({ shouldCrash }: { shouldCrash: boolean }) {
  if (shouldCrash) {
    throw new Error('Simulated panel rendering crash');
  }
  return <div>Healthy Workbench Child Panel</div>;
}

describe('React 19 Workbench UI Components (@testing-library/react)', () => {
  it('renders children inside ErrorBoundary and isolates component crashes cleanly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const view = render(
      <ErrorBoundary fallbackTitle="Custom Boundary Alert">
        <CrashingChild shouldCrash={false} />
      </ErrorBoundary>
    );
    expect(view.container.textContent).toContain('Healthy Workbench Child Panel');

    view.rerender(
      <ErrorBoundary fallbackTitle="Custom Boundary Alert">
        <CrashingChild shouldCrash={true} />
      </ErrorBoundary>
    );
    expect(view.container.textContent).toContain('Custom Boundary Alert');
    expect(view.container.textContent).toContain('Simulated panel rendering crash');

    spy.mockRestore();
  });

  it('renders CliPanel with wire log entries and preset command triggers', () => {
    const sampleWireLog = [
      {
        frameId: 'rpc-test-101',
        timestamp: '2026-10-25T18:00:00Z',
        serverId: 'sql-ops-mcp',
        toolName: 'sql_execute_readonly_query',
        callerRole: 'sre_admin' as const,
        isMutation: false,
        approvalTokenProvided: false,
        status: 'SUCCESS' as const,
        latencyMs: 6,
        requestPayload: { query: 'SELECT * FROM deployments' },
        responsePayload: { rowCount: 3 }
      }
    ];

    const view = render(
      <CliPanel
        wireLog={sampleWireLog}
        callerRole="sre_admin"
        onRefreshState={async () => {}}
      />
    );

    expect(view.container.textContent).toContain('Live CLI Harness');
    expect(view.container.textContent).toContain('sql_execute_readonly_query');

    const input = view.container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('monopulse mcp list');
  });

  it('renders KaggleGpuDashboard with Recharts telemetry, KPI metrics, and time-window toggles', () => {
    const sampleJobs = [
      {
        jobId: 'kaggle-gpu-job-701',
        kernelSlug: 'monopulse-ops/trajectory-playbook-distiller-gpu',
        accelerator: 'NVIDIA_T4_X2' as const,
        mode: 'LOCAL_GPU_FALLBACK_DISTILLER' as const,
        sourceTrajectoryId: 'traj-prod-8810',
        status: 'COMPLETED' as const,
        trajectoriesProcessed: 14,
        rawStepCount: 8,
        distilledStepCount: 5,
        stepReductionPct: 37.5,
        computeDurationMs: 680,
        extractedPlaybookId: 'PB-LEDGER-CANARY-01',
        extractedMarkdown: '## Skill: PgBouncer Pool Saturation',
        timestamp: '2026-10-25T18:00:00Z'
      }
    ];

    const view = render(
      <KaggleGpuDashboard jobs={sampleJobs} avgStepReductionPct={37.9} />
    );

    expect(view.container.textContent).toContain('Kaggle GPU Compute Bridge Telemetry');
    expect(view.container.textContent).toContain('Peak GPU SM Utilization');
    expect(view.container.textContent).toContain('Kernel Execution Throughput');
    expect(view.container.textContent).toContain('Distillation Success Rate');
    expect(view.container.textContent).toContain('GPU SM & VRAM Utilization');

    const btn24h = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === '24h'
    );
    expect(btn24h).toBeDefined();
    if (btn24h) {
      fireEvent.click(btn24h);
    }
  });

  it('renders CommandPalette Simulation Mode toggle and triggers onToggleSimulationMode without production side effects', () => {
    const toggleSpy = vi.fn();
    const view = render(
      <CommandPalette
        open={true}
        onClose={() => {}}
        tools={[]}
        simulationMode={false}
        onToggleSimulationMode={toggleSpy}
        onSelectModule={() => {}}
        onSelectRole={() => {}}
        onSelectToolServer={() => {}}
        onEmitWebhook={() => {}}
      />
    );

    expect(view.container.textContent).toContain('Simulation Mode (Safe Sandbox Isolation)');
    const switchBtn = view.getByRole('switch', { name: 'Toggle Simulation Mode' });
    expect(switchBtn.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(switchBtn);
    expect(toggleSpy).toHaveBeenCalledWith(true);
  });

  it('filters incidents by Pending, In-Progress, and Resolved using the Incident Status Filter dropdown', () => {
    const sampleEvents: any[] = [
      {
        eventId: 'evt-pending-1',
        timestamp: '2026-10-27T01:00:00Z',
        source: 'slack.incident.webhook',
        service: 'checkout-ledger-svc',
        channelOrTicket: '#inc-prod-alerts',
        incomingPayloadSummary: 'Pending canary alert',
        status: 'APPROVAL_STAGED',
        approvalState: 'STAGED_1CLICK_READY',
        approvalToken: 'tok-1',
        precomputeLatencyMs: 320,
        rootCauseSynthesis: 'Pending synthesis',
        autonomousReadOnlyTrace: [],
        stagedMutations: []
      },
      {
        eventId: 'evt-inprogress-2',
        timestamp: '2026-10-27T01:05:00Z',
        source: 'github.canary.alert',
        service: 'webhook-dispatcher-v2',
        channelOrTicket: 'OPS-4819',
        incomingPayloadSummary: 'In-progress diagnostic event',
        status: 'PRECOMPUTING_CONTEXT',
        approvalState: 'STAGED_1CLICK_READY',
        approvalToken: 'tok-2',
        precomputeLatencyMs: 280,
        rootCauseSynthesis: 'In-progress synthesis',
        autonomousReadOnlyTrace: [],
        stagedMutations: []
      },
      {
        eventId: 'evt-resolved-3',
        timestamp: '2026-10-27T01:10:00Z',
        source: 'jira.issue.created',
        service: 'checkout-ledger-svc',
        channelOrTicket: 'OPS-4821',
        incomingPayloadSummary: 'Resolved canary rollback',
        status: 'REMEDIATION_EXECUTED',
        approvalState: 'APPROVED_AND_EXECUTED',
        approvedByRole: 'sre_admin',
        approvalToken: 'tok-3',
        precomputeLatencyMs: 410,
        rootCauseSynthesis: 'Resolved synthesis',
        autonomousReadOnlyTrace: [],
        stagedMutations: []
      }
    ];

    const view = render(
      <AmbientPanel
        events={sampleEvents}
        selectedEventId="evt-pending-1"
        onSelectEventId={() => {}}
        callerRole="sre_admin"
        runningKaggleJob={false}
        onApproveEvent={async () => ({ type: 'success', message: 'ok' })}
        onDistillEvent={async () => {}}
      />
    );

    const statusSelect = view.getByLabelText('Incident Status Filter') as HTMLSelectElement;
    expect(statusSelect).toBeDefined();
    expect(view.container.textContent).toContain('Incident Queue (3)');

    fireEvent.change(statusSelect, { target: { value: 'pending' } });
    expect(view.container.textContent).toContain('Incident Queue (1)');
    expect(view.container.textContent).toContain('Pending canary alert');

    fireEvent.change(statusSelect, { target: { value: 'in_progress' } });
    expect(view.container.textContent).toContain('Incident Queue (1)');
    expect(view.container.textContent).toContain('In-progress diagnostic event');

    fireEvent.change(statusSelect, { target: { value: 'resolved' } });
    expect(view.container.textContent).toContain('Incident Queue (1)');
    expect(view.container.textContent).toContain('Resolved canary rollback');
  });

  it('exports incident and audit data when clicking the Export CSV button in the telemetry metrics section', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ambientEvents: [
          {
            eventId: 'evt-ambient-901',
            timestamp: '2026-10-27T02:00:00Z',
            source: 'slack.incident.webhook',
            service: 'checkout-ledger-svc',
            channelOrTicket: '#inc-prod-alerts',
            incomingPayloadSummary: '5xx spike',
            status: 'APPROVAL_STAGED',
            approvalState: 'STAGED_1CLICK_READY',
            approvalToken: 'tok-901',
            precomputeLatencyMs: 412,
            rootCauseSynthesis: 'PgBouncer lock contention',
            autonomousReadOnlyTrace: [],
            stagedMutations: []
          }
        ],
        mcpServers: [{ id: 'sql-ops-mcp', name: 'SQL Ops', transport: 'jsonrpc', status: 'HEALTHY', latencyP95Ms: 12, toolCount: 5, endpoint: '/mcp/sql', authMethod: 'RBAC' }],
        mcpTools: [],
        wireLog: [
          {
            frameId: 'rpc-901',
            timestamp: '2026-10-27T02:00:01Z',
            serverId: 'sql-ops-mcp',
            toolName: 'sql_execute_readonly_query',
            callerRole: 'sre_admin',
            isMutation: false,
            approvalTokenProvided: false,
            status: 'SUCCESS',
            latencyMs: 8,
            requestPayload: {},
            responsePayload: {}
          }
        ],
        redisTier1: [],
        pgvectorPlaybooks: [],
        kaggleGpuJobs: [],
        simulationMode: true,
        metrics: { avgStepReductionPct: 37.5 }
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const view = render(<App />);
    const exportBtn = await view.findByRole('button', { name: 'Export CSV' });
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn);
    expect(view.container.textContent).toContain('Exported 2 rows');
    vi.unstubAllGlobals();
  });

  it('toggles progressive disclosure for diagnostic traces and staged action payloads in AmbientPanel', () => {
    const sampleEvents: any[] = [
      {
        eventId: 'evt-ambient-901',
        timestamp: '2026-10-27T01:00:00Z',
        source: 'slack.incident.webhook',
        service: 'checkout-ledger-svc',
        channelOrTicket: '#inc-prod-alerts',
        incomingPayloadSummary: '5xx spike after canary dep-9042',
        status: 'APPROVAL_STAGED',
        approvalState: 'STAGED_1CLICK_READY',
        approvalToken: 'appr_sig_9042',
        precomputeLatencyMs: 320,
        rootCauseSynthesis: 'Unbounded SELECT FOR UPDATE starving PgBouncer pool.',
        autonomousReadOnlyTrace: [
          {
            step: 1,
            serverId: 'sql-ops-mcp',
            toolName: 'sql_execute_readonly_query',
            args: { query: 'SELECT * FROM deployments' },
            findingSummary: 'Identified active canary dep-9042 serving 25% traffic.',
            latencyMs: 18
          }
        ],
        stagedMutations: [
          {
            id: 'mut-1',
            serverId: 'infra-mcp',
            toolName: 'infra_trigger_canary_rollback',
            description: 'Drain 25% canary traffic from dep-9042',
            requiredRole: 'sre_admin',
            args: { deploy_id: 'dep-9042' },
            status: 'STAGED_FOR_1CLICK'
          }
        ]
      }
    ];

    const view = render(
      <AmbientPanel
        events={sampleEvents}
        selectedEventId="evt-ambient-901"
        onSelectEventId={() => {}}
        callerRole="sre_admin"
        runningKaggleJob={false}
        onApproveEvent={async () => ({ type: 'success', message: 'ok' })}
        onDistillEvent={async () => {}}
      />
    );

    expect(view.container.textContent).toContain('Executive Summary & Root Cause Synthesis');
    const traceToggle = view.getByRole('button', { name: /View Full Diagnostic Overview/i });
    fireEvent.click(traceToggle);
    expect(view.container.textContent).toContain('SELECT * FROM deployments');

    const payloadToggle = view.getByRole('button', { name: /View Payload/i });
    fireEvent.click(payloadToggle);
    expect(view.container.textContent).toContain('"deploy_id": "dep-9042"');
  });
});


