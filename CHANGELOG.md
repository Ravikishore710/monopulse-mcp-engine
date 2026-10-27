# Changelog

All notable changes to the **MonoPulse** project are documented in this file.

## [Unreleased]
### Added
- Ongoing maintenance, weekly automated dependency reviews via `.github/dependabot.yml` and `renovate.json`, and continuous E2E regression tracking.

## [1.5.0] - 2026-10-27
### Added
- **Shared UI Hook & Design Tokens (`src/hooks/useApiAction.ts`, `src/theme.ts`, `tests/useApiAction.test.ts`)**: Extracted reusable `useApiAction` / `executeJsonRequest` hook and `THEME` Tailwind surface constants across `AmbientPanel.tsx`, `McpPanel.tsx`, `MemoryPanel.tsx`, and `TrustAuditPanel.tsx`.
- **Typed HTTP Entry-Point Schema Validation (`src/server/schemas/httpSchemas.ts`, `tests/apiValidation.test.ts`)**: Added strict Zod request-body schemas wired via `.safeParse(req.body)` across all Express `POST`/`PATCH` routes, returning `400 VALIDATION_ERROR` on malformed payloads.
- **Complete 28-Tool / 6-Server MCP Coverage Suite & Per-File CI Coverage Gate (`tests/mcpToolHandlers.full.test.ts`, `coverage/coverage-summary.json`)**: Added exhaustive tests for all 28 MCP tools across all 6 MCP servers and a CI gate requiring `>= 70%` line coverage across every `src/server/*.ts` module.
- **Explicit Dependabot & Renovate Automation (`.github/dependabot.yml`, `renovate.json`)**: Pinned all 14 direct and 21 dev dependencies in `package.json` to exact versions and documented weekly audit & update schedules in `README.md` and `CONTRIBUTING.md`.

## [1.4.0] - 2026-10-26
### Added
- **Enforced V8 Code Coverage Gate (`vitest.config.ts`, `.github/workflows/ci.yml`)**: Added `@vitest/coverage-v8` with enforced thresholds (`lines: 70%`, `branches: 60%`) and `npm run test:coverage` in CI.
- **Guaranteed Offline Connector Isolation (`MONOPULSE_FORCE_SIMULATION`)**: Added `MONOPULSE_FORCE_SIMULATION=true` override at the top of `getConnectorStatusSummary` and `isSimulationModeActive` in `src/server/liveConnectors.ts` so test and CI runs never trigger outbound network calls.
- **Express Error-Tracking Sink & Prometheus Counter (`src/server/app.ts`, `src/server/observabilityEngine.ts`)**: Added global Express error-handling middleware with `@sentry/node` + `pino` fallback and `monopulse_unhandled_errors_total` counter.

## [1.3.0] - 2026-10-26
### Added
- **Kaggle GPU Telemetry Dashboard (`src/components/KaggleGpuDashboard.tsx`)**: Added real-time `Recharts` visualization inside `MemoryPanel` displaying NVIDIA T4x2 SM & VRAM utilization and kernel execution throughput.
- **Full MCP 2024-11-05 Protocol & Governance (`src/server/mcpProtocolSpec.ts`, `src/server/durableLedger.ts`)**: Added `initialize`, `ping`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`, `completion/complete`, SHA-256 tamper-evident audit hash chains, Dead-Letter Queue (`DLQ`), and 2-Person `sre_admin` quorum approvals.

## [1.2.0] - 2026-10-26
### Added
- **System Load & Concurrency Stress Harness (`src/server/systemLoadStressTest.ts`, `tests/stressAndConcurrency.test.ts`)**: Added burst load testing for concurrent webhooks, MCP JSON-RPC calls, and SQLite approval lock contention.

## [1.1.0] - 2026-10-25
### Added
- **Embedded SQLite Engine & Live Connector Fallback (`src/server/sqliteEngine.ts`, `src/server/liveConnectors.ts`)**: Added `node:sqlite` (`PRAGMA query_only = ON`) operational tables, multi-statement AST SQL guard, and HMAC-SHA256 webhook signature verification (`X-MonoPulse-Signature-256`).

## [1.0.1] - 2026-10-25
### Changed
- **Modularization (`< 400 LOC` per module)**: Split `mcpRegistry.ts` into `mcpTypes.ts`, `mcpToolDefinitions.ts`, `mcpToolHandlers.ts`, and `mcpRegistry.ts`; decomposed `App.tsx` into modular operational panels.

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
