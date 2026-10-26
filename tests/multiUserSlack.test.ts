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
});
