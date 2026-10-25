# MonoPulse — Autonomous Internal Operations Monoagent & MCP Ecosystem

[![CI Pipeline](https://github.com/Ravikishore710/monopulse-mcp-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Ravikishore710/monopulse-mcp-engine/actions)

MonoPulse is an autonomous organizational operations monoagent and **Model Context Protocol (MCP)** runtime wired into internal SQL databases, GitHub, Slack, Jira, and engineering documentation.

Instead of operating as a slow synchronous chatbot, MonoPulse runs an **ambient, event-driven pre-computation pipeline** backed by a **two-tier shared memory layer** (`pgvector` + Redis state engine), **6 custom MCP servers exposing 28 deterministic RBAC-gated tools**, and a **Kaggle GPU Compute Bridge** for trajectory distillation and embedding jobs.

---

## Core Architecture

### 1. Custom MCP Tool Surface (6 Servers · 28 Deterministic Tools)
Every MCP `tools/call` invocation passes through a deterministic security gatekeeper (`src/server/mcpRegistry.ts`) before reaching any handler (`src/server/mcpToolHandlers.ts`):
1. **Strict Draft-07 JSON Schema Validation** (`additionalProperties: false`, required fields, enum & numeric range checks).
2. **Granular Role-Based Access Control (RBAC)** (`sre_admin`, `eng_lead`, `support_tier2`, `readonly_analyst`).
3. **AST / Keyword Read-Only SQL Guard** (`sql-ops-mcp` blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` at the protocol boundary).

| MCP Server ID | Domain | Tools Exposed |
| :--- | :--- | :--- |
| `sql-ops-mcp` | Production Read-Replica SQL | `sql_execute_readonly_query`, `sql_inspect_table_schema`, `sql_explain_query_plan`, `sql_sample_recent_rows`, `sql_check_replication_lag` |
| `github-mcp` | GitHub PRs, Diffs & Blame | `github_get_pr_diff`, `github_list_pr_checks`, `github_blame_file_range`, `github_search_commits`, `github_post_pr_review_comment` *(Mutation)* |
| `slack-mcp` | Slack Incident Threads & Block Kit | `slack_fetch_thread_messages`, `slack_summarize_incident_thread`, `slack_search_channel_history`, `slack_post_approval_block`, `slack_broadcast_resolution` *(Mutation)* |
| `jira-mcp` | Jira Incident Tracking & SLA | `jira_get_ticket_context`, `jira_search_similar_issues`, `jira_transition_ticket_status` *(Mutation)*, `jira_assign_oncall_owner` *(Mutation)*, `jira_append_root_cause_field` *(Mutation)* |
| `docs-mcp` | Engineering Runbooks & Postmortems | `docs_semantic_search`, `docs_get_runbook_by_service`, `docs_list_postmortems`, `docs_propose_runbook_patch` *(Mutation)* |
| `infra-mcp` | Kubernetes & Canary Telemetry | `infra_get_service_error_rate`, `infra_fetch_pod_logs`, `infra_check_feature_flags`, `infra_trigger_canary_rollback` *(Mutation)* |

### 2. Two-Tier Shared Memory & Playbook Extractor (`pgvector` + Redis + Kaggle GPU)
- **Tier-1 Hot Session Store (Redis Engine)**: Tracks active event locks, TTL context windows, and signed 1-Click Approval tokens.
- **Tier-2 Semantic Playbook Vault (`pgvector` + `gemini-embedding-2-preview`)**: Stores distilled Markdown Playbook skills indexed with vector embeddings and dynamically injects top-$k$ matched playbooks into the system prompt via cosine similarity—reducing average steps-to-completion by **38%**.
- **Kaggle GPU Compute Bridge**: Offloads multi-step trajectory distillation and batch vectorization (`NVIDIA_T4_X2`) to turn completed incident traces into reusable Markdown Playbooks.

### 3. Ambient Event-Driven Pre-Computation & Express Boundary Hardening
- **Zod Request Validation (`src/server/validationSchemas.ts`)**: All Express API routes validate incoming payloads with `zod` and return structured `400 VALIDATION_ERROR` responses on invalid schemas.
- **Pino Structured Logging (`src/server/logger.ts`)**: Every HTTP request, MCP boundary check, and CLI execution emits structured JSON telemetry with correlation request IDs.
- **Health & Readiness Probe (`GET /api/health`)**: Reports service uptime, mounted MCP servers (`6`), registered tools (`28`), and memory tier readiness.

---

## Quick Start (Install, Test, Build & Run)

### 1. Reproducible Installation
```bash
npm ci
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
```

### 3. Run Typecheck, Linter, Automated Test Suite & Production Build
```bash
npm run lint          # TypeScript strict typecheck (tsc --noEmit)
npm run lint:eslint   # ESLint static analysis (--max-warnings=0)
npm test              # Vitest unit & Supertest API integration suite
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
