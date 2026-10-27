# Changelog

All notable changes to the **MonoPulse** project are documented in this file.

## [Unreleased]
### Added
- **Typed HTTP Entry-Point Schema Validation (`src/server/schemas/httpSchemas.ts`, `tests/apiValidation.test.ts`)**: Added strict Zod request-body schemas (`IntegrationCreateSchema`, `IntegrationUpdateSchema`, `SlackMessageCreateSchema`, `WebhookIngestSchema`, `EventApprovalSchema`, `MemorySearchSchema`, `KaggleDistillSchema`, `CliExecSchema`) wired via `.safeParse(req.body)` across all Express `POST`/`PATCH` routes, returning `400 VALIDATION_ERROR` on malformed payloads.
- **Complete 28-Tool / 6-Server MCP Coverage Suite & Per-File CI Coverage Gate (`tests/mcpToolHandlers.full.test.ts`, `.github/workflows/ci.yml`)**: Added exhaustive tests for all 28 MCP tools across `sql-ops-mcp`, `github-mcp`, `slack-mcp`, `jira-mcp`, `docs-mcp`, and `infra-mcp` covering both allowed and `RBAC_DENIED` execution paths, plus a per-file CI gate requiring `>= 70%` line coverage across every `src/server/*.ts` module and a committed `coverage-summary.json` artifact.

### Changed
- **Pinned Core Build & Test Toolchain Versions (`package.json`, `package-lock.json`)**: Pinned exact resolved versions in `package.json` and `package-lock.json` (`vite@8.3.5`, `eslint@10.13.0`, `vitest@5.0.5`, `@vitest/coverage-v8@5.0.5`, `typescript@5.8.3`, `@sentry/node@11.9.0`, `express@4.22.3`, `zod@4.6.7`, `pino@10.4.0`, verified on Node.js `v22.23.4` / npm `10.9.9` with `0` audit vulnerabilities).
- **Removed Synthetic History Script**: Removed `scripts/rebuildGitHistory.ts` and `npm run git:history` so all repository history reflects genuine incremental commits.

## [1.4.0] - 2026-10-26
### Added
- **Enforced V8 Code Coverage Gate (`vitest.config.ts`, `.github/workflows/ci.yml`)**: Added `@vitest/coverage-v8` with enforced thresholds (`lines: 70%`, `branches: 60%`) and `npm run test:coverage` in CI.
- **Guaranteed Offline Connector Isolation (`MONOPULSE_FORCE_SIMULATION`)**: Added `MONOPULSE_FORCE_SIMULATION=true` override at the top of `getConnectorStatusSummary` and `isSimulationModeActive` in `src/server/liveConnectors.ts` so test and CI runs never trigger outbound network calls regardless of ambient environment tokens.
- **Express Error-Tracking Sink & Prometheus Counter (`src/server/app.ts`, `src/server/observabilityEngine.ts`)**: Added global Express error-handling middleware logging structured `pino` diagnostics (`errStack`, `route`, `callerRole`) and incrementing `monopulse_unhandled_errors_total` on `/api/metrics` without leaking stack traces in HTTP 500 responses.
- **Security & Reproducibility Hardening (`.env.example`, `.github/workflows/ci.yml`)**: Added all runtime and connector environment variables (`ARGOCD_AUTH_TOKEN`, `ARGOCD_SERVER_URL`, `LOG_LEVEL`, `PORT`, `NODE_ENV`, `MONOPULSE_PREVIOUS_SECRET`, `DISABLE_HMR`, `VITEST`, `MONOPULSE_FORCE_SIMULATION`) to `.env.example` and added `npm audit --audit-level=high` to CI.

## [1.3.0] - 2026-10-26
### Added
- **Kaggle GPU Telemetry Dashboard (`src/components/KaggleGpuDashboard.tsx`)**: Added real-time `Recharts` visualization inside `MemoryPanel` displaying NVIDIA T4x2 SM & VRAM utilization, kernel execution throughput (`trajectories/sec`), and step-distillation success rates across `15m`, `1h`, and `24h` windows.
- **Full MCP 2024-11-05 Protocol & Governance (`src/server/mcpProtocolSpec.ts`, `src/server/durableLedger.ts`)**: Added `initialize`, `ping`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`, `completion/complete`, JSON-RPC 2.0 batch support, SHA-256 tamper-evident audit hash chains, Dead-Letter Queue (`DLQ`), 2-Person `sre_admin` quorum approvals, and OpenAPI 3.1 specification (`/api/openapi.json`).
- **Embedded SQLite Engine & Live Connector Fallback (`src/server/sqliteEngine.ts`, `src/server/liveConnectors.ts`)**: Added `node:sqlite` (`PRAGMA query_only = ON`) operational tables, multi-statement AST SQL guard, HMAC-SHA256 webhook signature verification (`X-MonoPulse-Signature-256`), and circuit-breaker outbound connectors.

## [1.0.0] - 2026-10-25
### Added
- **Express Boundary Validation & Telemetry**: Added `zod` request validation schemas (`McpRpcRequestSchema`, `WebhookIngestSchema`, `EventApprovalSchema`, `MemorySearchSchema`, `KaggleDistillSchema`, `CliExecSchema`), `pino` structured JSON logging with correlation IDs, and `GET /api/health` readiness probes.
- **Automated Verification Suite (Vitest + Supertest)**: Added 43+ unit and integration assertions across 9 test suites (`tests/mcpRegistry.test.ts`, `tests/memoryEngine.test.ts`, `tests/ambientOrchestrator.test.ts`, `tests/apiRoutes.test.ts`, `tests/sqliteAndSecurity.test.ts`, `tests/mcpProtocolAndSse.test.ts`, `tests/enterpriseCapabilities.test.ts`, `tests/uiWorkbench.test.tsx`, `tests/cliHarness.test.ts`).
- **CI/CD & Container Sandboxing**: Added `.github/workflows/ci.yml` (`npm install`, `tsc --noEmit`, `npm run test`), `.github/dependabot.yml`, multi-stage `Dockerfile`, `docker-compose.yml` (`pgvector` + Redis), and `.devcontainer/devcontainer.json`.

### Changed
- **Modularization (`< 400 LOC` per module)**: Split `mcpRegistry.ts` into `mcpTypes.ts`, `mcpToolDefinitions.ts`, `mcpToolHandlers.ts`, and `mcpRegistry.ts`; decomposed `App.tsx` into `AmbientPanel.tsx`, `McpPanel.tsx`, `MemoryPanel.tsx`, `KaggleGpuDashboard.tsx`, `CliPanel.tsx`, and `TrustAuditPanel.tsx`.

## [0.3.0] - 2026-10-22
### Added
- **Ambient Event-Driven Pre-Computation Bus**: Implemented webhook ingestion (`slack.incident.webhook`, `jira.issue.created`, `github.canary.alert`) and 1-Click Approve/Edit staging to eliminate synchronous chat latency.

## [0.2.0] - 2026-10-18
### Added
- **Two-Tier Shared Memory & Playbook Extractor**: Implemented Tier-1 Redis session/TTL state store, Tier-2 `pgvector` cosine similarity engine powered by `gemini-embedding-2-preview`, and Kaggle GPU trajectory distillation bridge.

## [0.1.0] - 2026-10-14
### Added
- **MCP Server Surface & RBAC Gatekeeper**: Initial implementation of 6 custom MCP servers (`sql-ops-mcp`, `github-mcp`, `slack-mcp`, `jira-mcp`, `docs-mcp`, `infra-mcp`) exposing 28 deterministic tools with Draft-07 JSON Schema validation and read-only SQL guards.
