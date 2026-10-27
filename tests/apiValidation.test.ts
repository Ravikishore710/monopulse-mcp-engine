import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

describe('HTTP Entry-Point Zod Schema Validation (Rec 07)', () => {
  const app = createMonoPulseApp();

  it('returns 400 VALIDATION_ERROR on POST /api/integrations when name is missing or endpointUrl is invalid', async () => {
    const resShortName = await request(app)
      .post('/api/integrations')
      .send({ name: 'x', provider: 'Grafana' });
    expect(resShortName.status).toBe(400);
    expect(resShortName.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(resShortName.body.details)).toBe(true);

    const resBadUrl = await request(app)
      .post('/api/integrations')
      .send({ name: 'Valid Integration', endpointUrl: 'not-a-valid-url' });
    expect(resBadUrl.status).toBe(400);
    expect(resBadUrl.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR on POST /api/slack/messages when message text is empty or service enum is invalid', async () => {
    const resEmpty = await request(app)
      .post('/api/slack/messages')
      .send({ channelId: 'C04INCIDENTS', userHandle: 'ravi.kishore', text: '   ' });
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(resEmpty.body.details)).toBe(true);

    const resBadService = await request(app)
      .post('/api/slack/messages')
      .send({ text: 'Test incident message', service: 'unknown-microservice' });
    expect(resBadService.status).toBe(400);
    expect(resBadService.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR on POST /api/webhooks/ingest when payloadSummary is too short or source is invalid', async () => {
    const res = await request(app)
      .post('/api/webhooks/ingest')
      .send({
        source: 'invalid.webhook.source',
        service: 'checkout-ledger-svc',
        channelOrTicket: 'C',
        payloadSummary: 'abc'
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 400 VALIDATION_ERROR on POST /api/memory/search when query is too short or topK exceeds bounds', async () => {
    const res = await request(app)
      .post('/api/memory/search')
      .send({ query: 'x', topK: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 400 VALIDATION_ERROR on POST /api/cli/exec and POST /api/events/:eventId/approve for malformed bodies', async () => {
    const cliRes = await request(app)
      .post('/api/cli/exec')
      .send({ command: '', callerRole: 'invalid_role' });
    expect(cliRes.status).toBe(400);
    expect(cliRes.body.error).toBe('VALIDATION_ERROR');

    const approveRes = await request(app)
      .post('/api/events/evt-ambient-901/approve')
      .send({ callerRole: 'not_a_valid_role' });
    expect(approveRes.status).toBe(400);
    expect(approveRes.body.error).toBe('VALIDATION_ERROR');
  });
});
