import { describe, expect, it } from 'vitest';
import {
  MCP_SERVERS,
  MCP_TOOLS,
  executeMCPToolCall,
  validateMCPToolSchema
} from '../src/server/mcpRegistry.ts';

describe('MCP Registry & Tool Boundary Gatekeeper', () => {
  it('registers exactly 6 custom MCP servers and 28 deterministic tools', () => {
    expect(MCP_SERVERS).toHaveLength(6);
    expect(MCP_TOOLS).toHaveLength(28);
  });

  it('executes a valid read-only SQL query for readonly_analyst role', () => {
    const res = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query: "SELECT deploy_id, service, status FROM deployments WHERE service = 'checkout-ledger-svc'",
        row_limit: 5
      },
      callerRole: 'readonly_analyst'
    });

    expect(res.status).toBe('SUCCESS');
    expect(res.httpCode).toBe(200);
    expect(res.result?.readOnlyVerified).toBe(true);
    expect(res.result?.rows.length).toBeGreaterThan(0);
  });

  it('returns RBAC_DENIED (HTTP 403) when readonly_analyst invokes infra_trigger_canary_rollback', () => {
    const res = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: {
        deploy_id: 'dep-9042',
        reason: 'Attempted unauthorized rollback'
      },
      callerRole: 'readonly_analyst'
    });

    expect(res.status).toBe('RBAC_DENIED');
    expect(res.httpCode).toBe(403);
    expect(res.error?.code).toBe(-32003);
  });

  it('returns SCHEMA_INVALID (HTTP 400) when undeclared properties or out-of-range integers are supplied', () => {
    const res = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query: 'SELECT * FROM deployments',
        row_limit: 5000,
        undeclared_extra_key: 'forbidden'
      },
      callerRole: 'sre_admin'
    });

    expect(res.status).toBe('SCHEMA_INVALID');
    expect(res.httpCode).toBe(400);
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.data?.violations).toHaveLength(2);
  });

  it('returns SQL_MUTATION_BLOCKED (HTTP 403) when DDL or DML statements are sent to sql-ops-mcp', () => {
    const dropRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'DROP TABLE deployments;' },
      callerRole: 'sre_admin'
    });
    expect(dropRes.status).toBe('SQL_MUTATION_BLOCKED');
    expect(dropRes.httpCode).toBe(403);
    expect(dropRes.error?.code).toBe(-32004);

    const deleteRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: "DELETE FROM deployments WHERE deploy_id = 'dep-9042'" },
      callerRole: 'sre_admin'
    });
    expect(deleteRes.status).toBe('SQL_MUTATION_BLOCKED');

    const stackedRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT 1; SELECT * FROM pg_stat_activity' },
      callerRole: 'sre_admin'
    });
    expect(stackedRes.status).toBe('SQL_MUTATION_BLOCKED');
  });

  it('validates enum constraints strictly in validateMCPToolSchema', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'sql_inspect_table_schema')!;
    const check = validateMCPToolSchema(tool, { table_name: 'non_existent_table' });
    expect(check.valid).toBe(false);
    expect(check.errors[0]).toContain('violates enum constraint');
  });

  it('executes GitHub, Slack, Jira, Docs, and Infra MCP tools deterministically', () => {
    const ghDiff = executeMCPToolCall({
      toolName: 'github_get_pr_diff',
      args: { pr_number: 1842 },
      callerRole: 'readonly_analyst'
    });
    expect(ghDiff.status).toBe('SUCCESS');
    expect(ghDiff.result?.pr_number).toBe(1842);

    const slackSummary = executeMCPToolCall({
      toolName: 'slack_summarize_incident_thread',
      args: { thread_ts: '1761406210.004200' },
      callerRole: 'support_tier2'
    });
    expect(slackSummary.status).toBe('SUCCESS');
    expect(slackSummary.result?.extracted_signals?.linked_jira).toBe('OPS-4821');

    const jiraCtx = executeMCPToolCall({
      toolName: 'jira_get_ticket_context',
      args: { ticket_key: 'OPS-4821' },
      callerRole: 'readonly_analyst'
    });
    expect(jiraCtx.status).toBe('SUCCESS');
    expect(jiraCtx.result?.key).toBe('OPS-4821');

    const runbook = executeMCPToolCall({
      toolName: 'docs_get_runbook_by_service',
      args: { service: 'checkout-ledger-svc' },
      callerRole: 'readonly_analyst'
    });
    expect(runbook.status).toBe('SUCCESS');
    expect(runbook.result?.doc_id).toBe('RUNBOOK-LEDGER-01');
  });
});
