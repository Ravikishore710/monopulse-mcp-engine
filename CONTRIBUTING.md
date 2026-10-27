# Contributing to MonoPulse

Thank you for contributing to **MonoPulse — Internal Operations Monoagent & MCP Ecosystem**.

## Runtime Prerequisites (Matched to `.github/workflows/ci.yml`)

- **Node.js**: `22.x` (verified on `v22.23.4`)
- **npm**: `10.x` (verified on `10.9.9`)

## Development Workflow

1. **Install Reproducible Dependencies**:
   ```bash
   rm -rf node_modules dist .data && npm ci && MONOPULSE_FORCE_SIMULATION=true bash scripts/smoke-test.sh
   ```
2. **Keep Modules Under 400 LOC**:
   - Server modules in `src/server/` and UI panels in `src/components/` must remain focused and under 400 lines of code (`src/theme.ts` and `src/hooks/useApiAction.ts` share UI tokens and fetch state).
3. **Enforce Zod Validation & RBAC Boundaries**:
   - Every new HTTP route in `src/server/app.ts` must validate `req.body` using a `zod` schema in `src/server/schemas/httpSchemas.ts`.
   - Every new MCP tool in `src/server/mcpToolDefinitions.ts` must declare `allowedRoles`, `isMutation`, and a strict `additionalProperties: false` Draft-07 `inputSchema`.
4. **Ship Changes Together with Vitest Specs**:
   - Every feature, refactor, or bugfix commit must be under ~200 changed lines and include corresponding unit or integration tests in `tests/*.test.ts`.
5. **Pre-Commit Verification Checklist**:
   ```bash
   npm run lint
   npm run lint:eslint
   npm run test:coverage
   npm run build
   ```
