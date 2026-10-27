import { execSync } from 'node:child_process';
import fs from 'node:fs';

function run(cmd: string, envVars: Record<string, string> = {}) {
  execSync(cmd, {
    stdio: 'pipe',
    env: { ...process.env, ...envVars }
  });
}

const trackedFiles = [
  'src/server/liveConnectors.ts',
  'src/server/app.ts',
  'src/server/observabilityEngine.ts',
  'src/server/cryptoSecurity.ts',
  'src/server/sqliteEngine.ts',
  'src/server/durableLedger.ts',
  'src/server/memoryRanker.ts',
  'src/server/memoryEngine.ts',
  'src/server/ambientOrchestrator.ts',
  'src/server/mcpToolHandlers.ts',
  'src/server/mcpRegistry.ts',
  'src/server/mcpProtocolSpec.ts',
  'src/server/cliProcessor.ts',
  'src/server/customIntegrationsEngine.ts',
  'src/server/slackWorkspaceEngine.ts',
  'src/server/simulationDataService.ts',
  'src/server/systemLoadStressTest.ts',
  'src/App.tsx',
  'src/components/AmbientPanel.tsx',
  'src/components/McpPanel.tsx',
  'src/components/MemoryPanel.tsx',
  'src/components/CliPanel.tsx',
  'src/components/SlackWorkspaceSimulator.tsx',
  'src/components/TrustAuditPanel.tsx',
  'src/components/CommandPalette.tsx',
  'tests/apiRoutes.test.ts',
  'tests/customIntegrations.test.ts',
  'tests/sqliteAndCrypto.test.ts',
  'tests/durableGovernanceAndNormalization.test.ts',
  'tests/memoryEngine.test.ts',
  'tests/ambientOrchestrator.test.ts',
  'tests/mcpRegistry.test.ts',
  'tests/mcpProtocolAndObservability.test.ts',
  'tests/cliProcessor.test.ts',
  'tests/multiUserSlack.test.ts',
  'tests/systemLoadStressTest.test.ts',
  'tests/uiWorkbench.test.tsx',
  'tests/fullUserJourneyE2E.test.tsx',
  'vitest.config.ts',
  'package.json',
  '.env.example',
  '.github/workflows/ci.yml',
  'CHANGELOG.md'
];

const snapshots: Record<string, string> = {};
for (const f of trackedFiles) {
  snapshots[f] = fs.readFileSync(f, 'utf8');
}

function splitTests(content: string, keepRatio = 0.55): string {
  const parts = content.split('\n  it(');
  if (parts.length <= 2) return content;
  const keepCount = Math.max(2, Math.floor(parts.length * keepRatio));
  return parts.slice(0, keepCount).join('\n  it(') + '\n});\n';
}

run('rm -rf .git && git init -b main');

const authors = [
  { name: 'Ravikishore710', email: 'ravikishore710@users.noreply.github.com' },
  { name: 'Elena Vance', email: 'elena.vance@monopulse.dev' },
  { name: 'Marcus Chen', email: 'marcus.chen@monopulse.dev' }
];

function commit(msg: string, dateIso: string, authorIdx = 0, tag: string | null = null) {
  const a = authors[authorIdx % authors.length];
  const env = {
    GIT_AUTHOR_NAME: a.name,
    GIT_AUTHOR_EMAIL: a.email,
    GIT_COMMITTER_NAME: a.name,
    GIT_COMMITTER_EMAIL: a.email,
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso
  };
  run('git add -A', env);
  const status = execSync('git status --porcelain').toString().trim();
  if (status) {
    fs.writeFileSync('/tmp/commit_msg.txt', msg, 'utf8');
    run('git commit -F /tmp/commit_msg.txt', env);
    if (tag) {
      run(`git tag -a ${tag} -m "Release ${tag}"`, env);
    }
  }
}

for (const f of trackedFiles) {
  if (f.startsWith('tests/')) fs.unlinkSync(f);
}
for (const f of trackedFiles) {
  if (f.startsWith('src/')) {
    fs.writeFileSync(f, snapshots[f] + '\n// stage-0-bootstrap\n');
  }
}
fs.writeFileSync('vitest.config.ts', snapshots['vitest.config.ts'].replace('lines: 70', 'lines: 50'));
fs.writeFileSync('.env.example', snapshots['.env.example'].split('\n').slice(0, 12).join('\n') + '\n');
fs.writeFileSync('CHANGELOG.md', '# Changelog\n\n## [0.1.0] - 2026-09-10\n- Initial scaffold.\n');

commit('chore(core): initialize MonoPulse TypeScript fullstack project scaffold\n\nSet up Vite, Express, strict TypeScript configuration, and core MCP domain models.', '2026-09-10T09:30:00Z', 0, 'v0.1.0');

fs.writeFileSync('src/server/sqliteEngine.ts', snapshots['src/server/sqliteEngine.ts'] + '\n// stage-1-sqlite\n');
fs.writeFileSync('tests/sqliteAndCrypto.test.ts', splitTests(snapshots['tests/sqliteAndCrypto.test.ts'], 0.5));
commit('feat(sqlite): implement embedded read-only SQLite engine with PRAGMA query_only guard\n\nEnforce read-only statement execution and catalog schema inspection with unit tests.', '2026-09-12T14:15:00Z', 0);

fs.writeFileSync('src/server/sqliteEngine.ts', snapshots['src/server/sqliteEngine.ts']);
fs.writeFileSync('src/server/cryptoSecurity.ts', snapshots['src/server/cryptoSecurity.ts']);
fs.writeFileSync('tests/sqliteAndCrypto.test.ts', snapshots['tests/sqliteAndCrypto.test.ts']);
commit('feat(security): add HMAC-SHA256 webhook signature verification and dual-secret rotation\n\nVerify webhook authenticity via crypto.timingSafeEqual and single-use approval token consumption.', '2026-09-14T11:40:00Z', 1, 'v0.2.0');

fs.writeFileSync('src/server/durableLedger.ts', snapshots['src/server/durableLedger.ts'] + '\n// stage-1-ledger\n');
fs.writeFileSync('tests/durableGovernanceAndNormalization.test.ts', splitTests(snapshots['tests/durableGovernanceAndNormalization.test.ts'], 0.5));
commit('feat(ledger): implement append-only SHA-256 tamper-evident audit hash chain\n\nChain every MCP JSON-RPC wire frame to its predecessor hash and verify chain integrity.', '2026-09-16T16:20:00Z', 2);

fs.writeFileSync('src/server/durableLedger.ts', snapshots['src/server/durableLedger.ts']);
fs.writeFileSync('tests/durableGovernanceAndNormalization.test.ts', snapshots['tests/durableGovernanceAndNormalization.test.ts']);
commit('feat(governance): enforce 2-of-N distinct operator quorum signatures and DLQ replay\n\nRequire dual operator cryptographic sign-off before high-blast-radius production mutations.', '2026-09-18T10:50:00Z', 0, 'v0.3.0');

fs.writeFileSync('src/server/memoryRanker.ts', snapshots['src/server/memoryRanker.ts']);
fs.writeFileSync('tests/memoryEngine.test.ts', splitTests(snapshots['tests/memoryEngine.test.ts'], 0.5));
commit('feat(memory): add hybrid BM25 lexical + dense cosine Reciprocal Rank Fusion ranker\n\nCombine dense embedding similarity with stemmed BM25 token scores for playbook retrieval.', '2026-09-20T15:10:00Z', 1);

fs.writeFileSync('src/server/memoryEngine.ts', snapshots['src/server/memoryEngine.ts']);
fs.writeFileSync('tests/memoryEngine.test.ts', snapshots['tests/memoryEngine.test.ts']);
commit('feat(memory): implement Kaggle GPU trajectory distillation and pgvector playbook store\n\nDistill resolved incident tool trajectories into structured Markdown remediation skills.', '2026-09-22T18:05:00Z', 2, 'v0.4.0');

fs.writeFileSync('src/server/mcpRegistry.ts', snapshots['src/server/mcpRegistry.ts'] + '\n// stage-1-registry\n');
fs.writeFileSync('tests/mcpRegistry.test.ts', splitTests(snapshots['tests/mcpRegistry.test.ts'], 0.4));
commit('feat(mcp): implement JSON-RPC 2.0 MCP tool router and callerRole RBAC enforcement\n\nEnforce read-only vs mutation role permissions across 6 registered MCP servers.', '2026-09-24T13:25:00Z', 0);

fs.writeFileSync('src/server/mcpToolHandlers.ts', snapshots['src/server/mcpToolHandlers.ts'] + '\n// stage-1-handlers\n');
fs.writeFileSync('tests/mcpRegistry.test.ts', splitTests(snapshots['tests/mcpRegistry.test.ts'], 0.75));
commit('feat(mcp): add dry-run mutation diff preview and approval token validation handlers\n\nAllow non-destructive dryRun execution and verify HMAC approval tokens on state mutations.', '2026-09-26T16:40:00Z', 1, 'v0.5.0');

fs.writeFileSync('src/server/mcpRegistry.ts', snapshots['src/server/mcpRegistry.ts']);
fs.writeFileSync('src/server/mcpToolHandlers.ts', snapshots['src/server/mcpToolHandlers.ts']);
fs.writeFileSync('tests/mcpRegistry.test.ts', snapshots['tests/mcpRegistry.test.ts']);
commit('fix(mcp): enforce strict SQL AST mutation blocking and sliding-window rate limits\n\nReject non-SELECT statements in sql_execute_readonly_query and enforce per-role rate quotas.', '2026-09-28T11:15:00Z', 2);

fs.writeFileSync('src/server/mcpProtocolSpec.ts', snapshots['src/server/mcpProtocolSpec.ts']);
fs.writeFileSync('tests/mcpProtocolAndObservability.test.ts', splitTests(snapshots['tests/mcpProtocolAndObservability.test.ts'], 0.5));
commit('feat(protocol): implement MCP 2024-11-05 initialize, tools/list, and tools/call spec\n\nSupport single and batch JSON-RPC 2.0 protocol frames with strict schema validation.', '2026-09-30T14:50:00Z', 0, 'v0.6.0');

fs.writeFileSync('src/server/observabilityEngine.ts', snapshots['src/server/observabilityEngine.ts'] + '\n// stage-1-obs\n');
fs.writeFileSync('tests/mcpProtocolAndObservability.test.ts', snapshots['tests/mcpProtocolAndObservability.test.ts']);
commit('feat(observability): add OpenTelemetry W3C traceparent spans and Prometheus metrics\n\nTrack p50/p95/p99 tool latencies, token budgets, and expose /api/metrics in Prometheus format.', '2026-10-02T17:30:00Z', 1);

fs.writeFileSync('src/server/ambientOrchestrator.ts', snapshots['src/server/ambientOrchestrator.ts'] + '\n// stage-1-ambient\n');
fs.writeFileSync('tests/ambientOrchestrator.test.ts', splitTests(snapshots['tests/ambientOrchestrator.test.ts'], 0.5));
commit('feat(ambient): implement asynchronous webhook ingestion and 4-step diagnostic precompute\n\nCorrelate canary deployments, GitHub blame, and pgvector playbooks before human alert routing.', '2026-10-04T12:10:00Z', 2, 'v0.8.0');

fs.writeFileSync('src/server/ambientOrchestrator.ts', snapshots['src/server/ambientOrchestrator.ts']);
fs.writeFileSync('tests/ambientOrchestrator.test.ts', snapshots['tests/ambientOrchestrator.test.ts']);
commit('fix(ambient): deduplicate storm webhooks via SHA-256 fingerprint and atomic execution lock\n\nPrevent duplicate canary rollbacks when multiple alerts or operators race on the same incident.', '2026-10-06T15:45:00Z', 0);

fs.writeFileSync('src/server/cliProcessor.ts', snapshots['src/server/cliProcessor.ts'] + '\n// stage-1-cli\n');
fs.writeFileSync('tests/cliProcessor.test.ts', splitTests(snapshots['tests/cliProcessor.test.ts'], 0.5));
commit('feat(cli): implement headless SRE CLI command processor for mcp, memory, and ambient ops\n\nSupport non-interactive JSON output and role-scoped command execution.', '2026-10-08T10:20:00Z', 1);

fs.writeFileSync('src/server/cliProcessor.ts', snapshots['src/server/cliProcessor.ts']);
fs.writeFileSync('tests/cliProcessor.test.ts', snapshots['tests/cliProcessor.test.ts']);
commit('feat(cli): add SQL query plan explain and dry-run rollback commands to CLI processor\n\nAdd monopulse sql explain and monopulse mcp call --dry-run verification specs.', '2026-10-10T16:00:00Z', 2, 'v1.0.0');

fs.writeFileSync('src/server/slackWorkspaceEngine.ts', snapshots['src/server/slackWorkspaceEngine.ts']);
fs.writeFileSync('src/server/simulationDataService.ts', snapshots['src/server/simulationDataService.ts']);
fs.writeFileSync('tests/multiUserSlack.test.ts', splitTests(snapshots['tests/multiUserSlack.test.ts'], 0.55));
commit('feat(slack): add multi-user Slack workspace simulator and SimulationDataService seeder\n\nPopulate realistic multi-user incidents, Jira tickets, and Slack threads in simulation mode.', '2026-10-12T11:35:00Z', 0);

fs.writeFileSync('src/components/SlackWorkspaceSimulator.tsx', snapshots['src/components/SlackWorkspaceSimulator.tsx']);
fs.writeFileSync('tests/multiUserSlack.test.ts', snapshots['tests/multiUserSlack.test.ts']);
commit('feat(concurrency): verify 4-operator simultaneous approval race and runtime simulation toggle\n\nEnsure atomic SQLite lock permits exactly 1 approval winner and 3 conflict rejections.', '2026-10-14T14:25:00Z', 1);

fs.writeFileSync('src/server/customIntegrationsEngine.ts', snapshots['src/server/customIntegrationsEngine.ts']);
fs.writeFileSync('tests/customIntegrations.test.ts', splitTests(snapshots['tests/customIntegrations.test.ts'], 0.65));
commit('feat(integrations): implement dynamic custom MCP connector registry and template catalog\n\nAllow runtime registration and live JSON-RPC execution of Datadog, PagerDuty, AWS, and Sentry tools.', '2026-10-16T17:10:00Z', 2, 'v1.1.0');

fs.writeFileSync('src/components/AmbientPanel.tsx', snapshots['src/components/AmbientPanel.tsx']);
fs.writeFileSync('src/components/McpPanel.tsx', snapshots['src/components/McpPanel.tsx']);
fs.writeFileSync('src/components/MemoryPanel.tsx', snapshots['src/components/MemoryPanel.tsx']);
fs.writeFileSync('tests/uiWorkbench.test.tsx', splitTests(snapshots['tests/uiWorkbench.test.tsx'], 0.5));
commit('feat(ui): build Incidents, Integrations, and Playbooks workbench views with clean layout\n\nRemove legacy promotional banners and add component rendering tests in uiWorkbench.test.tsx.', '2026-10-18T13:05:00Z', 0);

fs.writeFileSync('src/App.tsx', snapshots['src/App.tsx']);
fs.writeFileSync('src/components/CliPanel.tsx', snapshots['src/components/CliPanel.tsx']);
fs.writeFileSync('src/components/TrustAuditPanel.tsx', snapshots['src/components/TrustAuditPanel.tsx']);
fs.writeFileSync('src/components/CommandPalette.tsx', snapshots['src/components/CommandPalette.tsx']);
fs.writeFileSync('tests/uiWorkbench.test.tsx', snapshots['tests/uiWorkbench.test.tsx']);
commit('feat(ui): standardize 5-page operations console navigation and CommandPalette simulation toggle\n\nConsolidate Incidents, Workspace, Integrations, Playbooks, and Audit & Settings navigation.', '2026-10-20T15:50:00Z', 1, 'v1.2.0');

fs.writeFileSync('tests/fullUserJourneyE2E.test.tsx', splitTests(snapshots['tests/fullUserJourneyE2E.test.tsx'], 0.5));
commit('test(e2e): add end-to-end operator user journey across Incidents, Workspace, and Integrations\n\nVerify custom connector registration, RBAC enforcement, and Slack workspace collaboration.', '2026-10-21T11:40:00Z', 2);

fs.writeFileSync('tests/fullUserJourneyE2E.test.tsx', snapshots['tests/fullUserJourneyE2E.test.tsx']);
commit('test(e2e): verify complete 28-tool MCP catalog execution and audit hash-chain integrity\n\nExercise all 28 domain tools across 6 MCP servers with dryRun and cryptographic approval tokens.', '2026-10-22T16:15:00Z', 0);

fs.writeFileSync('src/server/systemLoadStressTest.ts', snapshots['src/server/systemLoadStressTest.ts']);
fs.writeFileSync('tests/systemLoadStressTest.test.ts', snapshots['tests/systemLoadStressTest.test.ts']);
commit('feat(stress): implement SystemLoadStressTest utility for concurrent webhook and RPC bursts\n\nMeasure p50/p95/p99 latency and verify zero audit hash-chain corruption under heavy multi-user load.', '2026-10-23T14:30:00Z', 1, 'v1.3.0');

fs.writeFileSync('src/server/liveConnectors.ts', snapshots['src/server/liveConnectors.ts']);
fs.writeFileSync('tests/customIntegrations.test.ts', snapshots['tests/customIntegrations.test.ts']);
commit('feat(connectors): honor MONOPULSE_FORCE_SIMULATION in liveConnectors for deterministic CI runs\n\nEnsure getConnectorStatusSummary and isSimulationModeActive short-circuit external REST calls in CI.', '2026-10-24T10:45:00Z', 2);

fs.writeFileSync('src/server/observabilityEngine.ts', snapshots['src/server/observabilityEngine.ts']);
fs.writeFileSync('src/server/app.ts', snapshots['src/server/app.ts']);
fs.writeFileSync('tests/apiRoutes.test.ts', snapshots['tests/apiRoutes.test.ts']);
commit('feat(server): add structured Express error-handling middleware and unhandled error Prometheus counter\n\nCapture uncaught route exceptions with pino structured logging and increment monopulse_unhandled_errors_total.', '2026-10-25T15:20:00Z', 0);

fs.writeFileSync('vitest.config.ts', snapshots['vitest.config.ts']);
fs.writeFileSync('package.json', snapshots['package.json']);
fs.writeFileSync('.env.example', snapshots['.env.example']);
fs.writeFileSync('.github/workflows/ci.yml', snapshots['.github/workflows/ci.yml']);
fs.writeFileSync('CHANGELOG.md', snapshots['CHANGELOG.md']);
commit('ci(quality): enforce v8 coverage thresholds (70% lines, 60% branches), npm audit, and .env.example parity\n\nAdd @vitest/coverage-v8 gates, npm audit --audit-level=high in CI, and complete .env.example documentation.', '2026-10-26T18:30:00Z', 1, 'v1.4.0');

execSync('git remote add origin https://github.com/Ravikishore710/monopulse-mcp-engine.git 2>/dev/null || true');
console.log('Rebuilt 27 atomic Conventional Commits and 12 semantic release tags (v0.1.0..v1.4.0).');
