import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMonoPulseApp } from '../src/server/app.ts';
import { SystemLoadStressTest } from '../src/server/systemLoadStressTest.ts';

const app = createMonoPulseApp();

describe('SystemLoadStressTest Utility & Multi-User Operational Stress Verification', () => {
  it('executes SystemLoadStressTest.runStressTest directly and verifies latency percentiles, race-condition safety, and SHA-256 hash-chain integrity', async () => {
    const report = await SystemLoadStressTest.runStressTest({
      webhookBurstSize: 9,
      rpcBurstSize: 16,
      competingApprovers: 6
    });

    expect(report.utility).toBe('SystemLoadStressTest');
    expect(report.status).toBe('PASSED');
    expect(report.simulationModeEnforced).toBe(true);
    expect(report.totalConcurrentOperations).toBe(9 + 16 + 6 + 2);
    expect(report.throughputOpsPerSec).toBeGreaterThan(0);

    // Verify response time percentile telemetry
    expect(report.responseTimeTelemetry.sampleCount).toBe(9 + 16 + 6);
    expect(report.responseTimeTelemetry.minMs).toBeGreaterThanOrEqual(0);
    expect(report.responseTimeTelemetry.p50Ms).toBeGreaterThanOrEqual(report.responseTimeTelemetry.minMs);
    expect(report.responseTimeTelemetry.p95Ms).toBeGreaterThanOrEqual(report.responseTimeTelemetry.p50Ms);
    expect(report.responseTimeTelemetry.p99Ms).toBeGreaterThanOrEqual(report.responseTimeTelemetry.p95Ms);
    expect(report.responseTimeTelemetry.maxMs).toBeGreaterThanOrEqual(report.responseTimeTelemetry.p99Ms);

    // Verify webhook burst deduplication
    expect(report.webhookBurst.totalFired).toBe(9);
    expect(report.webhookBurst.deduplicatedCount).toBeGreaterThanOrEqual(6);

    // Verify multi-role MCP RPC burst (read-only, HMAC-signed mutations, RBAC blocks, SQL DDL blocks)
    expect(report.mcpRpcBurst.totalCalls).toBe(16);
    expect(report.mcpRpcBurst.allowedSuccessCount).toBeGreaterThanOrEqual(8);
    expect(report.mcpRpcBurst.hmacSignedMutationSuccessCount).toBeGreaterThanOrEqual(2);
    expect(report.mcpRpcBurst.rbacDeniedCount).toBeGreaterThanOrEqual(2);
    expect(report.mcpRpcBurst.sqlMutationBlockedCount).toBeGreaterThanOrEqual(1);

    // Verify 6-way competing approval race condition (exactly 1 winner, 5 blocked)
    expect(report.approvalRaceConditionTest.concurrentApprovers).toBe(6);
    expect(report.approvalRaceConditionTest.winnerCount).toBe(1);
    expect(report.approvalRaceConditionTest.blockedDuplicateCount).toBe(5);
    expect(report.approvalRaceConditionTest.quorumMet).toBe(true);
    expect(report.approvalRaceConditionTest.exactlyOneExecutionVerified).toBe(true);

    // Verify SQLite audit log & SHA-256 Merkle chain integrity under concurrent writes
    expect(report.stateIntegrity.auditHashChainValid).toBe(true);
    expect(report.stateIntegrity.checkedFrames).toBeGreaterThan(0);
    expect(report.stateIntegrity.headHash).toHaveLength(64);
    expect(report.stateIntegrity.sqliteAuditRowCount).toBeGreaterThan(0);
  });

  it('exposes SystemLoadStressTest via POST /api/system/stress-test and POST /api/system/load-test', async () => {
    const res = await request(app)
      .post('/api/system/stress-test')
      .send({ webhookBurstSize: 6, rpcBurstSize: 12, competingApprovers: 4 });

    expect(res.status).toBe(200);
    expect(res.body.utility).toBe('SystemLoadStressTest');
    expect(res.body.status).toBe('PASSED');
    expect(res.body.responseTimeTelemetry.p95Ms).toBeGreaterThanOrEqual(0);
    expect(res.body.stateIntegrity.auditHashChainValid).toBe(true);
  });
});
