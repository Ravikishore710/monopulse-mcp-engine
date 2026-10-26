import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

describe('Custom Integrations & Multi-Platform Connector Hub (/api/integrations)', () => {
  const app = createMonoPulseApp();

  it('lists pre-configured enterprise integrations across PagerDuty, Datadog, Sentry, Linear, GitHub, Jira, Slack, MS Teams, and ArgoCD', async () => {
    const res = await request(app).get('/api/integrations');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(9);
    expect(Array.isArray(res.body.integrations)).toBe(true);
    const providers = res.body.integrations.map((i: any) => i.provider);
    expect(providers).toContain('PagerDuty');
    expect(providers).toContain('Datadog');
    expect(providers).toContain('Sentry');
    expect(providers).toContain('Linear');
    expect(providers).toContain('Microsoft Teams');
  });

  it('registers a new custom integration, verifies its endpoint, triggers a pre-computed incident, and deletes it', async () => {
    const createRes = await request(app)
      .post('/api/integrations')
      .send({
        name: 'Grafana OnCall Prometheus Bridge',
        provider: 'Grafana Labs',
        category: 'Observability & APM',
        protocol: 'REST Webhook (HMAC-SHA256)',
        endpointUrl: 'https://oncall.grafana.com/integrations/v1/webhook/monopulse',
        authMethod: 'HMAC-SHA256 Secret',
        mappedService: 'checkout-ledger-svc'
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('CREATED');
    const createdId = createRes.body.integration.id;
    expect(createdId).toMatch(/^int-custom-/);

    const verifyRes = await request(app).post(`/api/integrations/${createdId}/test`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.status).toBe('VERIFIED_OK');
    expect(verifyRes.body.signatureVerified).toBe(true);

    const triggerRes = await request(app)
      .post(`/api/integrations/${createdId}/trigger`)
      .send({ summary: '[GRAFANA ALERT] High p99 latency on checkout-ledger-svc' });
    expect(triggerRes.status).toBe(201);
    expect(triggerRes.body.status).toBe('INCIDENT_PRECOMPUTED');
    expect(triggerRes.body.event.eventId).toMatch(/^evt-ambient-/);

    const patchRes = await request(app)
      .patch(`/api/integrations/${createdId}`)
      .send({ status: 'PAUSED' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.integration.status).toBe('PAUSED');

    const deleteRes = await request(app).delete(`/api/integrations/${createdId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deletedId).toBe(createdId);
  });
});
