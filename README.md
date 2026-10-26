# MonoPulse — Autonomous Internal Operations Monoagent & MCP Ecosystem

[![CI Pipeline](https://github.com/Ravikishore710/monopulse-mcp-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Ravikishore710/monopulse-mcp-engine/actions)

MonoPulse is an autonomous organizational operations monoagent and **Model Context Protocol (MCP `2024-11-05`)** runtime wired into internal SQLite/PostgreSQL databases, GitHub, Slack, Jira, and engineering documentation.

Instead of operating as a slow synchronous chatbot, MonoPulse runs an **ambient, event-driven pre-computation pipeline** backed by a **two-tier shared memory layer** (`pgvector` + BM25 Reciprocal Rank Fusion + Redis state engine), **6 custom MCP servers exposing 28 deterministic RBAC-gated tools**, an embedded **`node:sqlite` operational & cryptographic audit ledger**, and a **Kaggle GPU Compute Bridge (`KaggleGpuDashboard`)** for trajectory distillation and embedding jobs.

---

## Core Architecture

### 1. Custom MCP Tool Surface (6 Servers · 28 Deterministic Tools · MCP `2024-11-05`)
Every MCP `tools/call` invocation passes through a deterministic security gatekeeper (`src/server/mcpRegistry.ts`) before reaching any handler (`src/server/mcpToolHandlers.ts`):
1. **Strict Draft-07 JSON Schema Validation** (`additionalProperties: false`, required fields, enum & numeric range checks).
2. **Granular Role-Based Access Control (RBAC)** (`sre_admin`, `eng_lead`, `support_tier2`, `readonly_analyst`) + cryptographic Bearer token verification (`src/server/cryptoSecurity.ts`).
3. **AST / Multi-Statement Read-Only SQL Guard & `PRAGMA query_only = ON`** (`sql-ops-mcp` blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `ATTACH`, and stacked semicolon statements at the protocol boundary).
4. **Full MCP `2024-11-05` Lifecycle**: Supports `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`, `completion/complete`, and JSON-RPC 2.0 batch arrays.

| MCP Server ID | Domain | Tools Exposed |
| :--- | :--- | :--- |
| `sql-ops-mcp` | Production Read-Replica SQL | `sql_execute_readonly_query`, `sql_inspect_table_schema`, `sql_explain_query_plan`, `sql_sample_recent_rows`, `sql_check_replication_lag` |
| `github-mcp` | GitHub PRs, Diffs & Blame | `github_get_pr_diff`, `github_list_pr_checks`, `github_blame_file_range`, `github_search_commits`, `github_post_pr_review_comment` *(Mutation)* |
| `slack-mcp` | Slack Incident Threads & Block Kit | `slack_fetch_thread_messages`, `slack_summarize_incident_thread`, `slack_search_channel_history`, `slack_post_approval_block`, `slack_broadcast_resolution` *(Mutation)* |
| `jira-mcp` | Jira Incident Tracking & SLA | `jira_get_ticket_context`, `jira_search_similar_issues`, `jira_transition_ticket_status` *(Mutation)*, `jira_assign_oncall_owner` *(Mutation)*, `jira_append_root_cause_field` *(Mutation)* |
| `docs-mcp` | Engineering Runbooks & Postmortems | `docs_semantic_search`, `docs_get_runbook_by_service`, `docs_list_postmortems`, `docs_propose_runbook_patch` *(Mutation)* |
| `infra-mcp` | Kubernetes & Canary Telemetry | `infra_get_service_error_rate`, `infra_fetch_pod_logs`, `infra_check_feature_flags`, `infra_trigger_canary_rollback` *(Mutation)* |

### 2. Two-Tier Shared Memory, Playbook Extractor & `KaggleGpuDashboard`
- **Tier-1 Hot Session Store (Redis Engine)**: Tracks active event locks, TTL context windows, and HMAC-SHA256 signed 1-Click Approval tokens.
- **Tier-2 Semantic Playbook Vault (`pgvector` + BM25 Hybrid RRF + `gemini-embedding-2-preview`)**: Stores distilled Markdown Playbook skills indexed with vector embeddings and dynamically injects top-$k$ matched playbooks into the system prompt—reducing average steps-to-completion by **38%**.
- **Kaggle GPU Compute Bridge & Recharts Telemetry (`src/components/KaggleGpuDashboard.tsx`)**: Offloads multi-step trajectory distillation (`NVIDIA_T4_X2`) and visualizes real-time GPU SM/VRAM utilization, kernel execution throughput (`trajectories/sec`), and distillation step-compression metrics inside `MemoryPanel`.

### 3. Ambient Event-Driven Pre-Computation, Cryptographic Audit & Governance
- **HMAC-SHA256 Webhook Verification & Replay Protection**: Validates `X-MonoPulse-Signature-256` with `crypto.timingSafeEqual` and 300s replay windows (`X-MonoPulse-Timestamp`).
- **Tamper-Evident SHA-256 Audit Hash Chain & DLQ (`src/server/durableLedger.ts`)**: Chains every MCP wire execution frame cryptographically in SQLite (`GET /api/security/hash-chain/verify`) and isolates failed mutations in a Dead-Letter Queue (`GET /api/security/dlq`).
- **Observability & OpenAPI 3.1**: Exposes Kubernetes liveness/readiness probes (`/api/health/live`, `/api/health/ready`), Prometheus histograms (`GET /api/metrics`), Server-Sent Events (`GET /api/events/stream`), and OpenAPI 3.1 (`GET /api/openapi.json`).

---

## Quick Start (Install, Test, Build & Run)

### 1. Reproducible Installation
```bash
npm install
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
```

### 3. Run Typecheck, Linter, Automated Test Suite & Production Build
```bash
npm run lint          # TypeScript strict typecheck (tsc --noEmit)
npm run lint:eslint   # ESLint static analysis (--max-warnings=0)
npm run test          # Vitest unit, UI & Supertest API integration suite (9 test files)
npm run build         # Vite production bundle build
```

### 4. Start the Backend Engine & Live Protocol Inspector (Port 3000)
```bash
npm run dev
```

### 5. Run in Isolated Docker Container Sandbox
```bash
docker compose up --build
```

### 6. Run the Standalone CLI Harness
```bash
npm run cli -- mcp list
npm run cli -- rbac test-unauthorized
npm run cli -- webhook emit ledger
npm run cli -- memory search "PgBouncer connection pool exhaustion"
npm run cli -- kaggle distill evt-ambient-901
```
