const LIVE_TOKEN_ENV_VARS = [
  'GITHUB_TOKEN',
  'SLACK_BOT_TOKEN',
  'JIRA_API_TOKEN',
  'ARGOCD_AUTH_TOKEN'
] as const;

export function assertTestIsolationEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.MONOPULSE_FORCE_SIMULATION) {
    env.MONOPULSE_FORCE_SIMULATION = 'true';
  }
  if (env.MONOPULSE_FORCE_SIMULATION !== 'true') {
    throw new Error(
      `Test isolation violation: MONOPULSE_FORCE_SIMULATION must be 'true' during test startup (received '${env.MONOPULSE_FORCE_SIMULATION}').`
    );
  }
  for (const key of LIVE_TOKEN_ENV_VARS) {
    const val = env[key];
    if (val && val.trim().length > 0) {
      throw new Error(
        `Test isolation violation: Live external token '${key}' is set in the test environment. Unset live credentials before running Vitest.`
      );
    }
  }
}

assertTestIsolationEnvironment(process.env);
