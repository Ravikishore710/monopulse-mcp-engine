# Security Policy & Cryptographic Architecture

## Supported Versions

| Version | Supported | SQLite Persistence | HMAC-SHA256 Signatures | MCP Spec 2024-11-05 |
| :--- | :--- | :--- | :--- | :--- |
| `1.2.x` | Yes | Full (`PRAGMA query_only` RO guard) | Webhook + Replay Window + Approval Tokens | Tools, Resources, Prompts, Batch RPC |
| `1.1.x` | Yes | Core Tables | Webhook + Approval Tokens | Tools |
| `< 1.0` | No | In-Memory Only | None | Partial |

## Security Controls Enforced in MonoPulse

1. **MCP Tool Boundary Gatekeeper (`src/server/mcpRegistry.ts`)**
   - Every `tools/call` invocation is validated against a strict JSON Schema (`additionalProperties: false`, required properties, enum constraints, numeric bounds) before reaching any handler.
   - Granular Role-Based Access Control (`sre_admin`, `eng_lead`, `support_tier2`, `readonly_analyst`) is enforced per tool.
   - `sql-ops-mcp` enforces both an AST/keyword single-statement `SELECT` guard and SQLite `PRAGMA query_only = ON` so DDL/DML, stacked queries (`;`), and comment injections (`--`, `/* */`) are blocked at both the protocol and database kernel layers.

2. **Cryptographic Webhook & Approval Token Verification (`src/server/cryptoSecurity.ts`)**
   - Incoming webhooks (`POST /api/webhooks/ingest`) verify `X-MonoPulse-Signature-256` (`sha256=<hmac>`) using `crypto.timingSafeEqual` and enforce a 300-second replay window on `X-MonoPulse-Timestamp`.
   - Human-in-the-loop 1-Click Approval blocks issue `mp_sig_v1.<expiresAt>.<argsDigest>.<hmac>` tokens bound to the canonicalized JSON tool arguments, preventing post-approval parameter tampering or replay attacks.

3. **Secret & PII Redaction (`src/server/mcpProtocolSpec.ts` & `src/server/logger.ts`)**
   - Pino structured logs redact authorization headers and secret keys (`redact: ['req.headers.authorization', '*.token', '*.secret', '*.apiKey']`).
   - MCP wire logs scrub Bearer tokens, GitHub PATs (`ghp_...`), Slack tokens (`xoxb-...`), and AWS access keys (`AKIA...`) before persisting to `mcp_audit_log`.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories on `github.com/Ravikishore710/monopulse-mcp-engine/security/advisories`. We respond to all reports within 48 hours.
