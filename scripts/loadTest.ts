import 'dotenv/config';
import request from 'supertest';
import { createMonoPulseApp } from '../src/server/app.ts';

async function main() {
  const app = createMonoPulseApp();
  console.log('================================================================');
  console.log(' MONOPULSE SYSTEM LOAD STRESS TEST & AUDIT INTEGRITY HARNESS    ');
  console.log('================================================================');

  // 1. Enable Simulation Mode & Populate Multi-User Dataset
  const simRes = await request(app).post('/api/system/simulation').send({ enabled: true });
  console.log(
    `[1/2] Simulation Mode Activated: ${simRes.body.simulationMode} | Seeded SQL Rows=${simRes.body.simulationDataset.counts.totalSqlRows}, Jira Tickets=${simRes.body.simulationDataset.counts.jiraTickets}, Slack Threads=${simRes.body.simulationDataset.counts.slackThreads}`
  );

  // 2. Execute SystemLoadStressTest Burst
  const loadRes = await request(app)
    .post('/api/system/stress-test')
    .send({ webhookBurstSize: 9, rpcBurstSize: 16, competingApprovers: 6 });
  const report = loadRes.body;

  console.log(
    `[2/2] Stress Status: ${report.status} (${report.totalConcurrentOperations} concurrent ops in ${report.durationMs}ms · ~${report.throughputOpsPerSec} ops/sec · p95=${report.responseTimeTelemetry?.p95Ms}ms)`
  );
  console.log('----------------------------------------------------------------');
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'PASSED') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Load stress test failed:', err);
  process.exit(1);
});
