# Contributing to MonoPulse

Thank you for contributing to **MonoPulse — Internal Operations Monoagent & MCP Ecosystem**.

## Development Workflow

1. **Install Reproducible Dependencies**:
   ```bash
   npm ci
   ```
2. **Keep Modules Under 400 LOC**:
   - Server modules in `src/server/` and UI panels in `src/components/` must remain focused and under 400 lines of code.
3. **Enforce Zod Validation & RBAC Boundaries**:
   - Every new HTTP route in `src/server/app.ts` must validate `req.body` using a `zod` schema in `src/server/validationSchemas.ts`.
   - Every new MCP tool in `src/server/mcpToolDefinitions.ts` must declare `allowedRoles`, `isMutation`, and a strict `additionalProperties: false` Draft-07 `inputSchema`.
4. **Ship Changes Together with Vitest Specs**:
   - Every feature, refactor, or bugfix commit must include corresponding unit or integration tests in `tests/*.test.ts`.
5. **Pre-Commit Verification Checklist**:
   ```bash
   npm run lint
   npm run lint:eslint
   npm test
   npm run build
   ```
