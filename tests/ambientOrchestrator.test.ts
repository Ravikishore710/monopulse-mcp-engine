import { describe, expect, it } from 'vitest';
import {
  executeStagedApprovalBlock,
  ingestAmbientWebhookEvent
} from '../src/server/ambientOrchestrator.ts';

describe('Ambient Event-Driven Pre-Computation & 1-Click Approval Workflow', () => {
  it('ingests an incoming Slack incident webhook and pre-computes read-only diagnostic trace', async () => {
    const evt = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'P0 checkout-ledger-svc 5xx spike & PgBouncer saturation on canary dep-9042'
    });

    expect(evt.eventId).toMatch(/^evt-ambient-/);
    expect(evt.perceivedUserWaitMs).toBe(0);
    expect(evt.autonomousReadOnlyTrace.length).toBeGreaterThanOrEqual(2);
    expect(evt.approvalState).toBe('STAGED_1CLICK_READY');
    expect(evt.stagedMutations.length).toBeGreaterThan(0);
  });

  it('blocks staged mutations when caller role lacks required RBAC privilege', async () => {
    const evt = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'Test RBAC block on 1-click approval'
    });

    const res = executeStagedApprovalBlock({
      eventId: evt.eventId,
      callerRole: 'readonly_analyst'
    });

    expect(res.success).toBe(false);
    expect(res.results.some((r) => r.status === 'RBAC_DENIED')).toBe(true);
  });

  it('executes edited 1-Click Approval mutations when authorized as sre_admin', async () => {
    const evt = await ingestAmbientWebhookEvent({
      source: 'slack.incident.webhook',
      service: 'checkout-ledger-svc',
      channelOrTicket: '#inc-prod-alerts · OPS-4821',
      payloadSummary: 'Test 1-click edit and approve execution'
    });

    const firstMut = evt.stagedMutations[0];
    const res = executeStagedApprovalBlock({
      eventId: evt.eventId,
      callerRole: 'sre_admin',
      editedMutations: [
        {
          id: firstMut.id,
          args: {
            ...firstMut.args,
            reason: 'Edited by SRE lead before 1-Click execution'
          }
        }
      ]
    });

    expect(res.success).toBe(true);
    expect(res.event.approvalState).toBe('EDITED_AND_EXECUTED');
    expect(res.event.approvedByRole).toBe('sre_admin');
  });
});
