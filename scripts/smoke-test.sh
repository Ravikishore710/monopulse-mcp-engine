#!/usr/bin/env bash
set -euo pipefail

export MONOPULSE_FORCE_SIMULATION=true
unset GITHUB_TOKEN SLACK_BOT_TOKEN JIRA_API_TOKEN ARGOCD_AUTH_TOKEN SENTRY_DSN

echo "==> [1/5] Cleaning build artifacts (dist)..."
rm -rf dist

if [ "${CLEAN_NODE_MODULES:-false}" = "true" ] || [ ! -d "node_modules" ]; then
  echo "==> [2/5] Performing clean dependency install (rm -rf node_modules && npm ci)..."
  rm -rf node_modules
  npm ci
else
  echo "==> [2/5] Verifying locked dependencies (npm ci)..."
  npm ci
fi

echo "==> [3/5] Running TypeScript strict typecheck & ESLint static analysis..."
npm run lint
npm run lint:eslint

echo "==> [4/5] Running isolated Vitest test suite (MONOPULSE_FORCE_SIMULATION=true)..."
npm run test

echo "==> [5/5] Building production client bundle..."
npm run build

echo "==> Cold-clone smoke test completed with 0 errors."
