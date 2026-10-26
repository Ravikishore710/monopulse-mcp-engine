# Changelog

All notable changes to the **MonoPulse** project are documented in this file.

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
