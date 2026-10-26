// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { CliPanel } from '../src/components/CliPanel.tsx';
import { KaggleGpuDashboard } from '../src/components/KaggleGpuDashboard.tsx';

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
});
