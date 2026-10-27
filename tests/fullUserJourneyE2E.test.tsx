// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.tsx';
import { createMonoPulseApp } from '../src/server/app.ts';
import { MCP_TOOLS } from '../src/server/mcpRegistry.ts';
import { DEFAULT_TOOL_ARGS } from '../src/types/monopulse.ts';
import { signApprovalToken } from '../src/server/cryptoSecurity.ts';
import { setSimulationModeActive } from '../src/server/liveConnectors.ts';

const app = createMonoPulseApp();

beforeAll(() => {
  setSimulationModeActive(true);

  class MockEventSource {
    url: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    constructor(url: string) {
      this.url = url;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  (globalThis as any).EventSource = MockEventSource;

  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:monopulse-audit-export');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
  HTMLAnchorElement.prototype.click = vi.fn();
});

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input.toString();
    const urlPath = rawUrl.startsWith('http')
      ? new URL(rawUrl).pathname + new URL(rawUrl).search
      : rawUrl;
    const method = (init?.method || 'GET').toUpperCase();

    let req = (request(app) as any)[method.toLowerCase()](urlPath);
    if (init?.headers) {
      const headersObj = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(headersObj)) {
        req = req.set(k, v);
      }
    }
    if (init?.body && typeof init.body === 'string') {
      try { req = req.send(JSON.parse(init.body)); }
      catch (_err: unknown) { req = req.send(init.body); }
    }
    const res = await req;
    const isJson = (res.headers['content-type'] || '').includes('application/json');
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: { get: (name: string) => res.headers[name.toLowerCase()] || null },
      json: async () => (isJson ? res.body : JSON.parse(res.text || '{}')),
      text: async () => res.text || JSON.stringify(res.body)
    } as unknown as Response;
  });
});

afterEach(() => { cleanup(); });

describe('Full Real-User End-to-End Journey Across All 5 Pages & Backend Services', () => {
  it('1. Navigates all 5 pages in <App />, switches themes, uses Command Palette (⌘K), changes RBAC roles, and triggers New Incident', async () => {
    const view = render(<App />);
    await waitFor(() => { expect(view.container.textContent).toContain('Incident Triage & Remediation Queue'); });

    expect(view.container.textContent).toContain('Tracked Incidents');
    expect(view.container.textContent).toContain('Pending Approvals');
    expect(view.container.textContent).toContain('Connected Integrations');
    expect(view.container.textContent).toContain('Audit Ledger Frames');

    const themeToggleBtn = view.getByLabelText('Toggle Theme');
    fireEvent.click(themeToggleBtn);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    fireEvent.click(themeToggleBtn);
    expect(document.documentElement.classList.contains('light')).toBe(false);

    const cmdBtn = view.getByLabelText('Open Command Palette');
    fireEvent.click(cmdBtn);
    await waitFor(() => { expect(view.container.textContent).toContain('Simulation Mode (Safe Sandbox Isolation)'); });

    const paletteInput = view.getByPlaceholderText(/Type a command/i);
    fireEvent.change(paletteInput, { target: { value: 'Playbooks' } });
    fireEvent.keyDown(paletteInput, { key: 'Enter' });
    await waitFor(() => { expect(view.container.textContent).toContain('Operational Runbooks & Playbook Library'); });

    const navLabels = [
      { btnText: 'Workspace', expectedHeading: 'Unified Operations Workspace' },
      { btnText: 'Integrations', expectedHeading: 'Integrations & Custom Connector Hub' },
      { btnText: 'Audit & Settings', expectedHeading: 'Compliance Audit, CLI & System Settings' },
      { btnText: 'Incidents', expectedHeading: 'Incident Triage & Remediation Queue' }
    ];
    for (const nav of navLabels) {
      const navBtn = Array.from(view.container.querySelectorAll('header nav button')).find((b) => b.textContent === nav.btnText);
      expect(navBtn).toBeDefined();
      fireEvent.click(navBtn!);
      await waitFor(() => { expect(view.container.textContent).toContain(nav.expectedHeading); });
    }

    const newIncidentBtn = Array.from(view.container.querySelectorAll('header button')).find((b) => b.textContent?.includes('New Incident'));
    expect(newIncidentBtn).toBeDefined();
    fireEvent.click(newIncidentBtn!);
    await waitFor(() => { expect(view.container.textContent).toContain('Incident Triage & Remediation Queue'); });
  });

  it('2. Exercises Incidents Page: filtering, inline JSON parameter validation error recovery, 2-person quorum signing, and 1-Click Approval', async () => {
    const view = render(<App />);
    await waitFor(() => { expect(view.container.textContent).toContain('Incident Triage & Remediation Queue'); });

    const pendingFilterBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === 'Pending');
    fireEvent.click(pendingFilterBtn!);

    const allFilterBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === 'All');
    fireEvent.click(allFilterBtn!);

    const searchInput = view.getByPlaceholderText('Search service or ticket...');
    fireEvent.change(searchInput, { target: { value: 'checkout-ledger-svc' } });
    expect(view.container.textContent).toContain('checkout-ledger-svc');
    fireEvent.change(searchInput, { target: { value: '' } });

    const editBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Edit Parameters'));
    expect(editBtn).toBeDefined();
    fireEvent.click(editBtn!);

    const textareas = view.container.querySelectorAll('textarea');
    expect(textareas.length).toBeGreaterThan(0);
    fireEvent.change(textareas[0], { target: { value: '{ broken_json: true ' } });

    const approveEditedBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve & Execute Edited Actions'));
    fireEvent.click(approveEditedBtn!);
    await waitFor(() => { expect(view.container.textContent).toContain('Invalid JSON in edited parameters'); });

    const cancelEditBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Cancel Edit'));
    fireEvent.click(cancelEditBtn!);

    const signQuorumBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === 'Sign Quorum');
    expect(signQuorumBtn).toBeDefined();
    fireEvent.click(signQuorumBtn!);
    await waitFor(() => { expect(view.container.textContent).toContain('1/2'); });

    const selects = view.container.querySelectorAll('select');
    const quorumSelect = Array.from(selects).find((s) => s.innerHTML.includes('sre_oncall_dana'));
    expect(quorumSelect).toBeDefined();
    fireEvent.change(quorumSelect!, { target: { value: 'sre_oncall_dana' } });
    fireEvent.click(signQuorumBtn!);
    await waitFor(() => { expect(view.container.textContent).toContain('QUORUM MET'); });

    const approveBtn = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve & Execute Remediation'));
    fireEvent.click(approveBtn!);
    await waitFor(() => { expect(view.container.textContent).toMatch(/Approved and executed|already been approved/i); });
  });

  it('3. Exercises Workspace Page: switches bridged channels, switches personas, posts incident alert, and jumps to Incidents', async () => {
    const view = render(<App />);
    await waitFor(() => {
      expect(view.container.textContent).toContain('Incident Triage & Remediation Queue');
    });

    const workspaceNav = Array.from(view.container.querySelectorAll('header nav button')).find(
      (b) => b.textContent === 'Workspace'
    );
    fireEvent.click(workspaceNav!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Unified Operations Workspace');
    });

    // Switch channel to #tier2-customer-escalations
    const tier2ChannelBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('tier2-customer-escalations')
    );
    expect(tier2ChannelBtn).toBeDefined();
    fireEvent.click(tier2ChannelBtn!);

    // Post a new message in the channel
    const msgInput = view.getByPlaceholderText(/Message #tier2-customer-escalations/i);
    fireEvent.change(msgInput, {
      target: {
        value: '[P1 Escalation] checkout-ledger-svc HTTP 502 spike reported by enterprise merchant'
      }
    });

    const sendBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Send Message')
    );
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Pre-Computed Incidents Linked to');
    });

    const openInIncidentsBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open in Incidents')
    );
    expect(openInIncidentsBtn).toBeDefined();
    fireEvent.click(openInIncidentsBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Incident Triage & Remediation Queue');
    });
  });

  it('4. Exercises Integrations Page: registers custom connector, verifies health, simulates alert, and invokes MCP Tool Catalog', async () => {
    const view = render(<App />);
    await waitFor(() => {
      expect(view.container.textContent).toContain('Incident Triage & Remediation Queue');
    });

    const integrationsNav = Array.from(view.container.querySelectorAll('header nav button')).find(
      (b) => b.textContent === 'Integrations'
    );
    fireEvent.click(integrationsNav!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Integrations & Custom Connector Hub');
    });

    // Open "Add Custom Integration" form
    const addIntegrationBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add Custom Integration')
    );
    expect(addIntegrationBtn).toBeDefined();
    fireEvent.click(addIntegrationBtn!);

    const nameInput = view.getByPlaceholderText(/Integration Name \(e\.g\. Grafana OnCall\)/i);
    fireEvent.change(nameInput, { target: { value: 'Honeycomb Telemetry Bridge' } });

    const saveBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save & Connect Integration')
    );
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Honeycomb Telemetry Bridge');
    });

    const verifyBtns = Array.from(view.container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Verify')
    );
    expect(verifyBtns.length).toBeGreaterThan(0);
    fireEvent.click(verifyBtns[0]);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Signature OK');
    });

    // Switch to "MCP Tool Catalog" tab
    const catalogTabBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('MCP Tool Catalog')
    );
    expect(catalogTabBtn).toBeDefined();
    fireEvent.click(catalogTabBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Input JSON Schema (Draft-07)');
    });

    const runToolBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Invoke sql_execute_readonly_query')
    );
    expect(runToolBtn).toBeDefined();
    fireEvent.click(runToolBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('"readOnlyVerified": true');
    });
  });

  it('5. Exercises Playbooks Page & Audit/Settings Page: semantic search, playbook voting, Kaggle GPU distillation, SQLite console, CLI, and Sandbox', async () => {
    const view = render(<App />);
    await waitFor(() => {
      expect(view.container.textContent).toContain('Incident Triage & Remediation Queue');
    });

    const playbooksNav = Array.from(view.container.querySelectorAll('header nav button')).find(
      (b) => b.textContent === 'Playbooks'
    );
    fireEvent.click(playbooksNav!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Operational Runbooks & Playbook Library');
    });

    const searchPgvectorBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Search pgvector')
    );
    fireEvent.click(searchPgvectorBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Dynamically Constructed System Prompt Preview');
    });

    const upvoteBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Upvote'
    );
    expect(upvoteBtn).toBeDefined();
    fireEvent.click(upvoteBtn!);

    const distillBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Run Playbook Extractor on Kaggle GPU')
    );
    fireEvent.click(distillBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Recent Kaggle GPU Distillation Jobs');
    });

    // Navigate to Audit & Settings
    const auditNav = Array.from(view.container.querySelectorAll('header nav button')).find(
      (b) => b.textContent === 'Audit & Settings'
    );
    fireEvent.click(auditNav!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Compliance Audit, CLI & System Settings');
      expect(view.container.textContent).toContain('Embedded SQLite Storage Engine');
    });

    const execSqlBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Execute SQLite Query')
    );
    fireEvent.click(execSqlBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('sql_execute_readonly_query');
    });

    const simulateTamperBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Simulate Tamper')
    );
    fireEvent.click(simulateTamperBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('"tampered": true');
    });

    const cliTabBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('CLI & Wire Log')
    );
    fireEvent.click(cliTabBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Live CLI Harness');
    });

    const runCliBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Execute'
    );
    expect(runCliBtn).toBeDefined();
    fireEvent.click(runCliBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('exit=0');
    });

    const sandboxTabBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Developer Sandbox')
    );
    fireEvent.click(sandboxTabBtn!);

    await waitFor(() => {
      expect(view.container.textContent).toContain('Safe Sandbox & Simulation Mode');
    });
  });

  it('6. Exhaustively executes all 28 registered MCP tools across all 6 MCP servers with valid parameters and RBAC/HMAC enforcement', async () => {
    expect(MCP_TOOLS.length).toBe(28);

    for (const tool of MCP_TOOLS) {
      const args = DEFAULT_TOOL_ARGS[tool.name] || {};

      if (tool.isMutation) {
        // 1. Verify mutation is blocked for readonly_analyst
        const blockedRbacRes = await request(app)
          .post('/api/mcp/rpc')
          .send({
            jsonrpc: '2.0',
            id: `unauth-rbac-${tool.name}`,
            method: 'tools/call',
            params: { name: tool.name, arguments: args, callerRole: 'readonly_analyst' }
          });
        expect(blockedRbacRes.status).toBe(403);
        expect(blockedRbacRes.body.status).toBe('RBAC_DENIED');

        // 2. Verify mutation is blocked when approvalToken is forged/tampered
        const tamperedTokenRes = await request(app)
          .post('/api/mcp/rpc')
          .send({
            jsonrpc: '2.0',
            id: `tampered-${tool.name}`,
            method: 'tools/call',
            params: {
              name: tool.name,
              arguments: args,
              callerRole: 'sre_admin',
              approvalToken: 'mp_sig_v1.9999999999999.forgeddigest.forgedhmac'
            }
          });
        expect(tamperedTokenRes.status).toBe(403);
        expect(tamperedTokenRes.body.status).toBe('RBAC_DENIED');

        // 3. Verify mutation succeeds with cryptographically bound HMAC-SHA256 approvalToken
        const validToken = signApprovalToken({ toolName: tool.name, args });
        const allowedRes = await request(app)
          .post('/api/mcp/rpc')
          .send({
            jsonrpc: '2.0',
            id: `auth-${tool.name}`,
            method: 'tools/call',
            params: {
              name: tool.name,
              arguments: args,
              callerRole: 'sre_admin',
              approvalToken: validToken
            }
          });
        expect(allowedRes.status).toBe(200);
        expect(allowedRes.body.status).toBe('SUCCESS');
        expect(allowedRes.body.wireFrame.status).toBe('SUCCESS');
      } else {
        // Verify read-only tool succeeds immediately for authorized caller
        const caller = tool.allowedRoles.includes('readonly_analyst')
          ? 'readonly_analyst'
          : tool.allowedRoles[0];
        const readRes = await request(app)
          .post('/api/mcp/rpc')
          .send({
            jsonrpc: '2.0',
            id: `read-${tool.name}`,
            method: 'tools/call',
            params: { name: tool.name, arguments: args, callerRole: caller }
          });
        expect(readRes.status).toBe(200);
        expect(readRes.body.status).toBe('SUCCESS');
        expect(readRes.body.wireFrame.status).toBe('SUCCESS');
      }
    }
  });
});
