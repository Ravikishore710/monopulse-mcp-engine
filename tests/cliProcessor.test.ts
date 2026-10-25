import { describe, expect, it } from 'vitest';
import { processCliCommand } from '../src/server/cliProcessor.ts';

describe('MonoPulse CLI Command Harness Processor', () => {
  it('executes monopulse help and monopulse mcp list', async () => {
    const helpRes = await processCliCommand('monopulse help', 'sre_admin');
    expect(helpRes.exitCode).toBe(0);
    expect(helpRes.output).toContain('Available commands:');

    const listRes = await processCliCommand('monopulse mcp list', 'readonly_analyst');
    expect(listRes.exitCode).toBe(0);
    expect(listRes.output).toContain('[sql-ops-mcp]');
    expect(listRes.output).toContain('sql_execute_readonly_query');
  });

  it('executes monopulse rbac test-unauthorized and monopulse mcp call', async () => {
    const rbacRes = await processCliCommand('monopulse rbac test-unauthorized', 'readonly_analyst');
    expect(rbacRes.exitCode).toBe(0);
    expect(rbacRes.output).toContain('RBAC_DENIED');
    expect(rbacRes.output).toContain('SQL_MUTATION_BLOCKED');

    const callRes = await processCliCommand(
      `monopulse mcp call github_get_pr_diff '{"pr_number": 1842}'`,
      'readonly_analyst'
    );
    expect(callRes.exitCode).toBe(0);
    expect(callRes.output).toContain('"status": "SUCCESS"');
  });

  it('executes monopulse memory search, kaggle distill, and handles unknown commands', async () => {
    const searchRes = await processCliCommand(
      'monopulse memory search "PgBouncer lock contention"',
      'sre_admin'
    );
    expect(searchRes.exitCode).toBe(0);
    expect(searchRes.output).toContain('PB-LEDGER-CANARY-01');

    const distillRes = await processCliCommand('monopulse kaggle distill evt-ambient-901', 'sre_admin');
    expect(distillRes.exitCode).toBe(0);
    expect(distillRes.output).toContain('COMPLETED');

    const unknownRes = await processCliCommand('monopulse non-existent-subcommand', 'sre_admin');
    expect(unknownRes.exitCode).toBe(1);
    expect(unknownRes.output).toContain('Unknown command');
  });
});
