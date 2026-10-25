import {
  MCP_SERVERS,
  MCPServerMetadata,
  MCPToolDefinition,
  MCPWireFrame,
  RBACRole
} from './mcpTypes.ts';
import { MCP_TOOLS } from './mcpToolDefinitions.ts';
import { dispatchMCPToolHandler } from './mcpToolHandlers.ts';

export { MCP_SERVERS, MCP_TOOLS };
export type { MCPServerMetadata, MCPToolDefinition, MCPWireFrame, RBACRole };

export const WIRE_LOG: MCPWireFrame[] = [];

function recordWireFrame(frame: MCPWireFrame) {
  WIRE_LOG.unshift(frame);
  if (WIRE_LOG.length > 80) {
    WIRE_LOG.pop();
  }
}

/**
 * Deterministic JSON Schema Draft-07 Validator at the MCP Tool Boundary
 */
export function validateMCPToolSchema(
  tool: MCPToolDefinition,
  args: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, errors: ['Payload arguments must be a valid JSON object.'] };
  }

  for (const reqField of tool.inputSchema.required) {
    if (args[reqField] === undefined || args[reqField] === null || args[reqField] === '') {
      errors.push(`Missing required property '${reqField}'.`);
    }
  }

  if (tool.inputSchema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!tool.inputSchema.properties[key]) {
        errors.push(
          `Unknown property '${key}' is not permitted by strict schema (additionalProperties: false).`
        );
      }
    }
  }

  for (const [key, propSchema] of Object.entries(tool.inputSchema.properties)) {
    const val = args[key];
    if (val === undefined) continue;

    if (propSchema.type === 'string' && typeof val !== 'string') {
      errors.push(`Property '${key}' must be of type string (received ${typeof val}).`);
    } else if (
      propSchema.type === 'integer' &&
      (!Number.isInteger(val) || typeof val !== 'number')
    ) {
      errors.push(`Property '${key}' must be an integer (received ${JSON.stringify(val)}).`);
    } else if (propSchema.type === 'number' && typeof val !== 'number') {
      errors.push(`Property '${key}' must be a number (received ${typeof val}).`);
    } else if (propSchema.type === 'boolean' && typeof val !== 'boolean') {
      errors.push(`Property '${key}' must be a boolean (received ${typeof val}).`);
    }

    if (propSchema.enum && typeof val === 'string' && !propSchema.enum.includes(val)) {
      errors.push(
        `Property '${key}' value '${val}' violates enum constraint [${propSchema.enum.join(', ')}].`
      );
    }

    if (typeof val === 'number') {
      if (propSchema.minimum !== undefined && val < propSchema.minimum) {
        errors.push(`Property '${key}' (${val}) is below minimum ${propSchema.minimum}.`);
      }
      if (propSchema.maximum !== undefined && val > propSchema.maximum) {
        errors.push(`Property '${key}' (${val}) exceeds maximum ${propSchema.maximum}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Enforces JSON Schema validation, RBAC role authorization, and Read-Only SQL AST guards
 */
export function executeMCPToolCall(params: {
  toolName: string;
  args: Record<string, any>;
  callerRole: RBACRole;
  approvalToken?: string;
}): {
  jsonrpc: '2.0';
  id: string;
  status: 'SUCCESS' | 'RBAC_DENIED' | 'SCHEMA_INVALID' | 'SQL_MUTATION_BLOCKED';
  httpCode: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
  wireFrame: MCPWireFrame;
} {
  const start = Date.now();
  const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tool = MCP_TOOLS.find((t) => t.name === params.toolName);

  if (!tool) {
    const errorPayload = {
      code: -32601,
      message: `MCP Tool '${params.toolName}' not found in registered server surface.`
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: 'unknown',
      toolName: params.toolName,
      callerRole: params.callerRole,
      isMutation: false,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'SCHEMA_INVALID',
      latencyMs: Date.now() - start,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return {
      jsonrpc: '2.0',
      id: rpcId,
      status: 'SCHEMA_INVALID',
      httpCode: 404,
      error: errorPayload,
      wireFrame: wf
    };
  }

  // Step 1: Strict JSON Schema validation at the boundary
  const schemaCheck = validateMCPToolSchema(tool, params.args);
  if (!schemaCheck.valid) {
    const errorPayload = {
      code: -32602,
      message: `MCP Boundary JSON Schema Violation on '${tool.name}'`,
      data: {
        serverId: tool.serverId,
        violations: schemaCheck.errors,
        enforcedSchema: tool.inputSchema
      }
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: tool.serverId,
      toolName: tool.name,
      callerRole: params.callerRole,
      isMutation: tool.isMutation,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'SCHEMA_INVALID',
      latencyMs: Date.now() - start + 2,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return {
      jsonrpc: '2.0',
      id: rpcId,
      status: 'SCHEMA_INVALID',
      httpCode: 400,
      error: errorPayload,
      wireFrame: wf
    };
  }

  // Step 2: Granular RBAC check at the tool boundary
  if (!tool.allowedRoles.includes(params.callerRole)) {
    const errorPayload = {
      code: -32003,
      message: `RBAC_POLICY_DENIED: Caller role '${params.callerRole}' is not authorized to invoke ${tool.isMutation ? 'mutating' : 'restricted'} tool '${tool.name}' on server '${tool.serverId}'.`,
      data: {
        callerRole: params.callerRole,
        requiredRoles: tool.allowedRoles,
        isMutation: tool.isMutation
      }
    };
    const wf: MCPWireFrame = {
      frameId: rpcId,
      timestamp: new Date().toISOString(),
      serverId: tool.serverId,
      toolName: tool.name,
      callerRole: params.callerRole,
      isMutation: tool.isMutation,
      approvalTokenProvided: Boolean(params.approvalToken),
      status: 'RBAC_DENIED',
      latencyMs: Date.now() - start + 1,
      requestPayload: params.args,
      responsePayload: errorPayload
    };
    recordWireFrame(wf);
    return {
      jsonrpc: '2.0',
      id: rpcId,
      status: 'RBAC_DENIED',
      httpCode: 403,
      error: errorPayload,
      wireFrame: wf
    };
  }

  // Step 3: Additional SQL Read-Only AST/Keyword Guard
  if (tool.name === 'sql_execute_readonly_query' || tool.name === 'sql_explain_query_plan') {
    const rawSql = String(params.args.query || '').trim();
    const withoutTrailingSemicolon = rawSql.replace(/;$/, '');
    const hasStackedStatementsOrComments =
      withoutTrailingSemicolon.includes(';') || /(--|\/\*)/.test(rawSql);
    const forbiddenPattern =
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|REPLACE)\b/i;
    if (
      hasStackedStatementsOrComments ||
      forbiddenPattern.test(rawSql) ||
      !/^SELECT\b/i.test(rawSql)
    ) {
      const errorPayload = {
        code: -32004,
        message: `SQL_MUTATION_BLOCKED: Server 'sql-ops-mcp' enforces strict read-only single-statement SELECT execution. Blocked forbidden DDL/DML or stacked query at tool boundary.`,
        data: { rejectedQuery: rawSql }
      };
      const wf: MCPWireFrame = {
        frameId: rpcId,
        timestamp: new Date().toISOString(),
        serverId: tool.serverId,
        toolName: tool.name,
        callerRole: params.callerRole,
        isMutation: false,
        approvalTokenProvided: Boolean(params.approvalToken),
        status: 'SQL_MUTATION_BLOCKED',
        latencyMs: Date.now() - start + 2,
        requestPayload: params.args,
        responsePayload: errorPayload
      };
      recordWireFrame(wf);
      return {
        jsonrpc: '2.0',
        id: rpcId,
        status: 'SQL_MUTATION_BLOCKED',
        httpCode: 403,
        error: errorPayload,
        wireFrame: wf
      };
    }
  }

  // Step 4: Deterministic Execution
  const output = dispatchMCPToolHandler(tool.name, params.args, params.callerRole);

  const wf: MCPWireFrame = {
    frameId: rpcId,
    timestamp: new Date().toISOString(),
    serverId: tool.serverId,
    toolName: tool.name,
    callerRole: params.callerRole,
    isMutation: tool.isMutation,
    approvalTokenProvided: Boolean(params.approvalToken),
    status: 'SUCCESS',
    latencyMs: Math.max(4, Date.now() - start + 4),
    requestPayload: params.args,
    responsePayload: output
  };
  recordWireFrame(wf);

  return {
    jsonrpc: '2.0',
    id: rpcId,
    status: 'SUCCESS',
    httpCode: 200,
    result: output,
    wireFrame: wf
  };
}
