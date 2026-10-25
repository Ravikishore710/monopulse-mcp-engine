# Changelog

All notable changes to the **MonoPulse** project are documented in this file.

## [1.0.0] - 2026-10-25
### Added
- **Express Boundary Validation & Telemetry**: Added `zod` request validation schemas (`McpRpcRequestSchema`, `WebhookIngestSchema`, `EventApprovalSchema`, `MemorySearchSchema`, `KaggleDistillSchema`, `CliExecSchema`), `pino` structured JSON logging with correlation IDs, and `GET /api/health` readiness probes.
- **Automated Verification Suite (Vitest + Supertest)**: Added 38+ unit and integration assertions across `tests/mcpRegistry.test.ts`, `tests/memoryEngine.test.ts`, `tests/ambientOrchestrator.test.ts`, and `tests/apiRoutes.test.ts`.
- **CI/CD & Container Sandboxing**: Added `.github/workflows/ci.yml`, `.github/dependabot.yml`, multi-stage `Dockerfile`, `docker-compose.yml` (`pgvector` + Redis), and `.devcontainer/devcontainer.json`.

### Changed
- **Modularization (`< 380 LOC` per module)**: Split `mcpRegistry.ts` into `mcpTypes.ts`, `mcpToolDefinitions.ts`, `mcpToolHandlers.ts`, and `mcpRegistry.ts`; decomposed `App.tsx` into `AmbientPanel.tsx`, `McpPanel.tsx`, `MemoryPanel.tsx`, and `CliPanel.tsx`.

## [0.3.0] - 2026-10-22
### Added
- **Ambient Event-Driven Pre-Computation Bus**: Implemented webhook ingestion (`slack.incident.webhook`, `jira.issue.created`, `github.canary.alert`) and 1-Click Approve/Edit staging to eliminate synchronous chat latency.

## [0.2.0] - 2026-10-18
### Added
- **Two-Tier Shared Memory & Playbook Extractor**: Implemented Tier-1 Redis session/TTL state store, Tier-2 `pgvector` cosine similarity engine powered by `gemini-embedding-2-preview`, and Kaggle GPU trajectory distillation bridge.

## [0.1.0] - 2026-10-14
### Added
- **MCP Server Surface & RBAC Gatekeeper**: Initial implementation of 6 custom MCP servers (`sql-ops-mcp`, `github-mcp`, `slack-mcp`, `jira-mcp`, `docs-mcp`, `infra-mcp`) exposing 28 deterministic tools with Draft-07 JSON Schema validation and read-only SQL guards.
