// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { CliPanel } from '../src/components/CliPanel.tsx';

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
});
