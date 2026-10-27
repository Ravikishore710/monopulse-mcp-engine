# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.4.x   | :white_check_mark: |
| 1.3.x   | :white_check_mark: |
| < 1.3.0 | :x:                |

## Security Architecture & Controls

- **Webhook Authenticity**: All inbound webhooks (`/api/webhooks/ingest`) verify `X-MonoPulse-Signature-256` using HMAC-SHA256 and `crypto.timingSafeEqual`, with dual-secret rotation support (`MONOPULSE_SIGNING_SECRET` and `MONOPULSE_PREVIOUS_SECRET`).
- **Single-Use Cryptographic Approval Tokens**: State-mutating MCP tools require an HMAC-signed, time-bounded, single-use `approval_token` bound to `{eventId, toolName, canonicalArgs}` and optional 2-of-N distinct operator quorum sign-off.
- **SQL Read-Only Guard**: `sql_execute_readonly_query` enforces both AST-level mutation blocking and SQLite `PRAGMA query_only = ON`.
- **Tamper-Evident Audit Hash Chain**: Every JSON-RPC 2.0 wire frame is appended to an immutable SHA-256 hash chain verified via `GET /api/security/hash-chain/verify`.
- **CI Security Gates**: Every push and pull request runs `npm audit --audit-level=high` and automated secret scanning in GitHub Actions.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories on `Ravikishore710/monopulse-mcp-engine`. Do not open public issues containing exploit payloads or live credentials.
