import { describe, expect, it } from 'vitest';
import {
  MCP_SERVERS,
  MCP_TOOLS,
  WIRE_LOG,
  executeMCPToolCall,
  validateMCPToolSchema
} from '../src/server/mcpRegistry.ts';
import { signApprovalToken } from '../src/server/cryptoSecurity.ts';

describe('MCP Registry & Tool Boundary Gatekeeper', () => {
  it('registers all 6 custom MCP servers and 28 deterministic tools', () => {
    expect(MCP_SERVERS).toHaveLength(6);
    expect(MCP_TOOLS).toHaveLength(28);
  });

  it('executes a valid read-only SQL query and records a wire frame', () => {
    const res = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query:
          "SELECT deploy_id, service, status FROM deployments WHERE service = 'checkout-ledger-svc'",
        row_limit: 5
      },
      callerRole: 'readonly_analyst'
    });

    expect(res.status).toBe('SUCCESS');
    expect(res.httpCode).toBe(200);
    expect(res.result?.readOnlyVerified).toBe(true);
    expect(res.result?.rows.length).toBeGreaterThan(0);
    expect(WIRE_LOG.length).toBeGreaterThan(0);
    expect(res.wireFrame.status).toBe('SUCCESS');
  });

  it('returns RBAC_DENIED (HTTP 403) when unauthorized roles invoke mutating or restricted tools', () => {
    const rollbackDenied = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: {
        deploy_id: 'dep-9042',
        reason: 'Attempted unauthorized rollback'
      },
      callerRole: 'readonly_analyst'
    });

    expect(rollbackDenied.status).toBe('RBAC_DENIED');
    expect(rollbackDenied.httpCode).toBe(403);
    expect(rollbackDenied.error?.code).toBe(-32003);
    expect(rollbackDenied.error?.data?.requiredRoles).toContain('sre_admin');
    expect(rollbackDenied.wireFrame.status).toBe('RBAC_DENIED');

    const supportDeniedLeadTool = executeMCPToolCall({
      toolName: 'github_post_pr_review_comment',
      args: {
        pr_number: 1842,
        comment_body: 'Support tier attempting PR review comment without lead privileges'
      },
      callerRole: 'support_tier2'
    });

    expect(supportDeniedLeadTool.status).toBe('RBAC_DENIED');
    expect(supportDeniedLeadTool.httpCode).toBe(403);
  });

  it('returns RBAC_DENIED (HTTP 403) when an approvalToken is forged or mutation arguments are tampered with', () => {
    const validToken = signApprovalToken({
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9042', reason: 'Approved rollback' }
    });

    // Tamper with deploy_id after token signing
    const tamperedCall = executeMCPToolCall({
      toolName: 'infra_trigger_canary_rollback',
      args: { deploy_id: 'dep-9041-PROD-TAMPERED', reason: 'Approved rollback' },
      callerRole: 'sre_admin',
      approvalToken: validToken
    });

    expect(tamperedCall.status).toBe('RBAC_DENIED');
    expect(tamperedCall.httpCode).toBe(403);
    expect(tamperedCall.error?.code).toBe(-32005);
    expect(tamperedCall.error?.message).toContain('APPROVAL_TOKEN_TAMPERED');
  });

  it('returns SCHEMA_INVALID (HTTP 400/404) for missing required fields, undeclared properties, type mismatches, and unknown tools', () => {
    const unknownToolRes = executeMCPToolCall({
      toolName: 'non_existent_mcp_tool',
      args: {},
      callerRole: 'sre_admin'
    });
    expect(unknownToolRes.status).toBe('SCHEMA_INVALID');
    expect(unknownToolRes.httpCode).toBe(404);
    expect(unknownToolRes.error?.code).toBe(-32601);

    const schemaViolationRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: {
        query: 'SELECT * FROM deployments',
        row_limit: 5000,
        undeclared_extra_key: 'forbidden'
      },
      callerRole: 'sre_admin'
    });

    expect(schemaViolationRes.status).toBe('SCHEMA_INVALID');
    expect(schemaViolationRes.httpCode).toBe(400);
    expect(schemaViolationRes.error?.code).toBe(-32602);
    expect(schemaViolationRes.error?.data?.violations).toHaveLength(2);
    expect(schemaViolationRes.wireFrame.status).toBe('SCHEMA_INVALID');

    const missingRequiredRes = executeMCPToolCall({
      toolName: 'slack_broadcast_resolution',
      args: { channel_name: '#inc-prod-alerts' },
      callerRole: 'sre_admin'
    });
    expect(missingRequiredRes.status).toBe('SCHEMA_INVALID');
    expect(missingRequiredRes.httpCode).toBe(400);

    const wrongTypeRes = executeMCPToolCall({
      toolName: 'github_get_pr_diff',
      args: { pr_number: 'not-an-integer' as unknown as number },
      callerRole: 'sre_admin'
    });
    expect(wrongTypeRes.status).toBe('SCHEMA_INVALID');
    expect(wrongTypeRes.httpCode).toBe(400);
  });

  it('returns SQL_MUTATION_BLOCKED (HTTP 403) when DDL, DML, PRAGMA/ATTACH, stacked queries, or SQL comments are sent to sql-ops-mcp', () => {
    const dropRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'DROP TABLE deployments;' },
      callerRole: 'sre_admin'
    });
    expect(dropRes.status).toBe('SQL_MUTATION_BLOCKED');
    expect(dropRes.httpCode).toBe(403);
    expect(dropRes.error?.code).toBe(-32004);
    expect(dropRes.wireFrame.status).toBe('SQL_MUTATION_BLOCKED');

    const deleteRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: "DELETE FROM deployments WHERE deploy_id = 'dep-9042'" },
      callerRole: 'sre_admin'
    });
    expect(deleteRes.status).toBe('SQL_MUTATION_BLOCKED');

    const updateExplainRes = executeMCPToolCall({
      toolName: 'sql_explain_query_plan',
      args: { query: "UPDATE deployments SET status = 'HEALTHY'" },
      callerRole: 'sre_admin'
    });
    expect(updateExplainRes.status).toBe('SQL_MUTATION_BLOCKED');

    const pragmaInjectionRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT * FROM deployments WHERE PRAGMA query_only = 0' },
      callerRole: 'sre_admin'
    });
    expect(pragmaInjectionRes.status).toBe('SQL_MUTATION_BLOCKED');

    const stackedRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT 1; SELECT * FROM pg_stat_activity' },
      callerRole: 'sre_admin'
    });
    expect(stackedRes.status).toBe('SQL_MUTATION_BLOCKED');

    const commentInjectionRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT * FROM deployments -- bypass filter' },
      callerRole: 'sre_admin'
    });
    expect(commentInjectionRes.status).toBe('SQL_MUTATION_BLOCKED');

    const blockCommentRes = executeMCPToolCall({
      toolName: 'sql_execute_readonly_query',
      args: { query: 'SELECT /* inline comment */ * FROM deployments' },
      callerRole: 'sre_admin'
    });
    expect(blockCommentRes.status).toBe('SQL_MUTATION_BLOCKED');
  });

  it('validates enum and numeric constraints strictly in validateMCPToolSchema', () => {
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
