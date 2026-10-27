import { describe, expect, it } from 'vitest';
import { isSimulationModeActive, setSimulationModeActive } from '../src/server/liveConnectors.ts';
import { assertTestIsolationEnvironment } from './setup.ts';

describe('Simulation Mode & Test Isolation Guard (Rec 05)', () => {
  it('returns true from isSimulationModeActive() when NODE_ENV=test and no external tokens are set even if MONOPULSE_FORCE_SIMULATION is unset', () => {
    const prevForce = process.env.MONOPULSE_FORCE_SIMULATION;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevGh = process.env.GITHUB_TOKEN;
    const prevSlack = process.env.SLACK_BOT_TOKEN;
    const prevJira = process.env.JIRA_API_TOKEN;
    const prevArgo = process.env.ARGOCD_AUTH_TOKEN;

    try {
      delete process.env.MONOPULSE_FORCE_SIMULATION;
      process.env.NODE_ENV = 'test';
      delete process.env.GITHUB_TOKEN;
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.JIRA_API_TOKEN;
      delete process.env.ARGOCD_AUTH_TOKEN;
      setSimulationModeActive(false);

      expect(isSimulationModeActive()).toBe(true);
    } finally {
      process.env.MONOPULSE_FORCE_SIMULATION = prevForce;
      process.env.NODE_ENV = prevNodeEnv;
      if (prevGh !== undefined) process.env.GITHUB_TOKEN = prevGh;
      if (prevSlack !== undefined) process.env.SLACK_BOT_TOKEN = prevSlack;
      if (prevJira !== undefined) process.env.JIRA_API_TOKEN = prevJira;
      if (prevArgo !== undefined) process.env.ARGOCD_AUTH_TOKEN = prevArgo;
    }
  });

  it('throws a fast-fail error in assertTestIsolationEnvironment if any live external API token is present during test startup', () => {
    expect(() =>
      assertTestIsolationEnvironment({
        NODE_ENV: 'test',
        MONOPULSE_FORCE_SIMULATION: 'true',
        SLACK_BOT_TOKEN: 'xoxb- accidental-live-token'
      })
    ).toThrow(/Test isolation violation: Live external token 'SLACK_BOT_TOKEN'/);

    expect(() =>
      assertTestIsolationEnvironment({
        NODE_ENV: 'test',
        MONOPULSE_FORCE_SIMULATION: 'false'
      })
    ).toThrow(/Test isolation violation: MONOPULSE_FORCE_SIMULATION must be 'true'/);
  });
});
