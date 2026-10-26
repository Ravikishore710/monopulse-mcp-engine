import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

const app = createMonoPulseApp();

describe('Multi-User Slack Workspace Simulator & Concurrency Verification Suite', () => {
  it('returns the dummy Slack workspace with 6 operator personas and 3 incident channels on GET /api/slack/workspace', async () => {
    const res = await request(app).get('/api/slack/workspace');
    expect(res.status).toBe(200);
    expect(res.body.workspaceDomain).toBe('monopulse-prod.slack.com');
    expect(res.body.users.length).toBeGreaterThanOrEqual(6);
    expect(res.body.threads.length).toBeGreaterThanOrEqual(3);
    const handles = res.body.users.map((u: any) => u.handle);
    expect(handles).toContain('ravi.kishore');
    expect(handles).toContain('sre_oncall_dana');
    expect(handles).toContain('mchen');
    expect(handles).toContain('support_lead_maya');
    expect(handles).toContain('alex.analyst');
  });

  it('posts a dummy user Slack message and triggers @monopulse-mcp-bot ambient pre-computation on POST /api/slack/messages', async () => {
    const res = await request(app)
      .post('/api/slack/messages')
      .send({
        channelId: 'C04INCIDENTS',
        userHandle: 'sre_oncall_dana',
        text: '[FIRING: P0]PgBouncer pool exhaustion on checkout-ledger-svc in us-east-1',
        triggerAmbientPrecompute: true,
        service: 'checkout-ledger-svc'
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('MESSAGE_POSTED');
    expect(res.body.ambientEventTriggered).toBe(true);
    expect(res.body.ambientEvent?.eventId).toBeDefined();
    expect(res.body.ambientEvent?.approvalState).toBe('STAGED_1CLICK_READY');
  });

  it('executes the 5-user real-world concurrency & RBAC verification scenario on POST /api/slack/simulate-multiuser', async () => {
    const res = await request(app).post('/api/slack/simulate-multiuser').send({});
    expect(res.status).toBe(200);
    expect(res.body.allStepsPassed).toBe(true);
    expect(res.body.steps).toHaveLength(5);
    for (const step of res.body.steps) {
      expect(step.passed).toBe(true);
    }
  });

  it('isolates all external MCP connectors (Slack, Jira, GitHub) and seeds SimulationDataService when Simulation Mode is active', async () => {
    const enableRes = await request(app).post('/api/system/simulation').send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.simulationMode).toBe(true);
    expect(enableRes.body.simulationDataset.seeded).toBe(true);
    expect(enableRes.body.simulationDataset.counts.totalSqlRows).toBeGreaterThanOrEqual(20);
    expect(enableRes.body.simulationDataset.counts.jiraTickets).toBeGreaterThanOrEqual(5);
    expect(enableRes.body.simulationDataset.counts.slackThreads).toBeGreaterThanOrEqual(4);

    const ghConnector = enableRes.body.connectors.find((c: any) => c.serverId === 'github-mcp');
    const jiraConnector = enableRes.body.connectors.find((c: any) => c.serverId === 'jira-mcp');
    const slackConnector = enableRes.body.connectors.find((c: any) => c.serverId === 'slack-mcp');
    expect(ghConnector.mode).toBe('DETERMINISTIC_FALLBACK');
    expect(ghConnector.endpointBase).toBe('mock://github-sandbox');
    expect(jiraConnector.mode).toBe('DETERMINISTIC_FALLBACK');
    expect(jiraConnector.endpointBase).toBe('mock://jira-sandbox');
    expect(slackConnector.mode).toBe('DETERMINISTIC_FALLBACK');

    const verifyRes = await request(app).get('/api/security/connectors/verify');
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.simulationMode).toBe(true);
    expect(verifyRes.body.liveVerification.github.detail).toContain('SIMULATION_MODE_ACTIVE');
    expect(verifyRes.body.liveVerification.jira.detail).toContain('SIMULATION_MODE_ACTIVE');

    // Reset Simulation Mode back to false after test
    const disableRes = await request(app).post('/api/system/simulation').send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.simulationMode).toBe(false);
  });

  it('handles a burst of concurrent webhooks, multi-role MCP RPC calls, and 4-operator approval race conditions on POST /api/system/load-test', async () => {
    const res = await request(app).post('/api/system/load-test').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PASSED');
    expect(res.body.webhookBurst.totalFired).toBe(6);
    expect(res.body.webhookBurst.deduplicatedCount).toBeGreaterThanOrEqual(3);
    expect(res.body.mcpRpcBurst.rbacDeniedCount).toBeGreaterThanOrEqual(2);
    expect(res.body.mcpRpcBurst.sqlMutationBlockedCount).toBeGreaterThanOrEqual(1);
    expect(res.body.approvalRaceConditionTest.concurrentApprovers).toBe(4);
    expect(res.body.approvalRaceConditionTest.winnerCount).toBe(1);
    expect(res.body.approvalRaceConditionTest.blockedDuplicateCount).toBe(3);
    expect(res.body.approvalRaceConditionTest.exactlyOneExecutionVerified).toBe(true);
    expect(res.body.stateIntegrity.auditHashChainValid).toBe(true);

    // Reset Simulation Mode back to false after load test
    await request(app).post('/api/system/simulation').send({ enabled: false });
  });
});


