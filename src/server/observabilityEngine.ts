import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getSqliteDatabaseSummary } from './sqliteEngine.ts';

interface MetricCounterMap {
  [key: string]: number;
}

const mcpToolCallCounters: MetricCounterMap = {};
const httpRequestCounters: MetricCounterMap = {};
const webhookIngestCounters: MetricCounterMap = {};
const mcpLatencySamples: number[] = [];
const HISTOGRAM_BUCKETS = [5, 25, 100, 500];
const mcpHistogramBucketCounts: Record<string, number> = {
  '5': 0,
  '25': 0,
  '100': 0,
  '500': 0,
  '+Inf': 0
};
let mcpLatencySumMs = 0;
let mcpLatencyCount = 0;

export function incrementMcpToolMetric(toolName: string, status: string, role: string): void {
  const key = `tool="${toolName}",status="${status}",role="${role}"`;
  mcpToolCallCounters[key] = (mcpToolCallCounters[key] || 0) + 1;
}

export function recordMcpLatencyMs(latencyMs: number): void {
  const clean = Math.max(0, Number(latencyMs) || 1);
  mcpLatencySumMs += clean;
  mcpLatencyCount += 1;
  mcpLatencySamples.push(clean);
  if (mcpLatencySamples.length > 500) {
    mcpLatencySamples.shift();
  }
  for (const b of HISTOGRAM_BUCKETS) {
    if (clean <= b) {
      mcpHistogramBucketCounts[String(b)] += 1;
    }
  }
  mcpHistogramBucketCounts['+Inf'] += 1;
}

function computeQuantile(q: number): number {
  if (mcpLatencySamples.length === 0) return 0;
  const sorted = [...mcpLatencySamples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

export function incrementHttpMetric(method: string, route: string, status: number): void {
  const key = `method="${method}",route="${route}",status="${status}"`;
  httpRequestCounters[key] = (httpRequestCounters[key] || 0) + 1;
}

export function incrementWebhookMetric(service: string, deduplicated: boolean): void {
  const key = `service="${service}",deduplicated="${deduplicated}"`;
  webhookIngestCounters[key] = (webhookIngestCounters[key] || 0) + 1;
}

/**
 * Generates Prometheus text-based exposition format v0.0.4 including histograms, quantiles, and process metrics
 */
export function renderPrometheusMetrics(): string {
  const lines: string[] = [
    '# HELP monopulse_mcp_tool_calls_total Total MCP JSON-RPC tool invocations across boundary',
    '# TYPE monopulse_mcp_tool_calls_total counter'
  ];

  for (const [labels, count] of Object.entries(mcpToolCallCounters)) {
    lines.push(`monopulse_mcp_tool_calls_total{${labels}} ${count}`);
  }

  lines.push(
    '# HELP monopulse_mcp_tool_duration_ms_bucket MCP tool execution latency histogram buckets (ms)',
    '# TYPE monopulse_mcp_tool_duration_ms histogram'
  );
  for (const b of [...HISTOGRAM_BUCKETS.map(String), '+Inf']) {
    lines.push(`monopulse_mcp_tool_duration_ms_bucket{le="${b}"} ${mcpHistogramBucketCounts[b]}`);
  }
  lines.push(
    `monopulse_mcp_tool_duration_ms_sum ${mcpLatencySumMs}`,
    `monopulse_mcp_tool_duration_ms_count ${mcpLatencyCount}`,
    '# HELP monopulse_mcp_tool_duration_quantiles_ms MCP tool latency quantiles (p50, p95, p99)',
    '# TYPE monopulse_mcp_tool_duration_quantiles_ms summary',
    `monopulse_mcp_tool_duration_quantiles_ms{quantile="0.5"} ${computeQuantile(0.5)}`,
    `monopulse_mcp_tool_duration_quantiles_ms{quantile="0.95"} ${computeQuantile(0.95)}`,
    `monopulse_mcp_tool_duration_quantiles_ms{quantile="0.99"} ${computeQuantile(0.99)}`
  );

  lines.push(
    '# HELP monopulse_http_requests_total Total HTTP API requests processed',
    '# TYPE monopulse_http_requests_total counter'
  );
  for (const [labels, count] of Object.entries(httpRequestCounters)) {
    lines.push(`monopulse_http_requests_total{${labels}} ${count}`);
  }

  lines.push(
    '# HELP monopulse_webhook_ingest_total Total ambient webhooks ingested and deduplicated',
    '# TYPE monopulse_webhook_ingest_total counter'
  );
  for (const [labels, count] of Object.entries(webhookIngestCounters)) {
    lines.push(`monopulse_webhook_ingest_total{${labels}} ${count}`);
  }

  try {
    const sqlite = getSqliteDatabaseSummary();
    lines.push(
      '# HELP monopulse_sqlite_table_rows Current persisted row count per SQLite table',
      '# TYPE monopulse_sqlite_table_rows gauge'
    );
    for (const tbl of sqlite.tables) {
      lines.push(`monopulse_sqlite_table_rows{table="${tbl.name}"} ${tbl.rowCount}`);
    }
  } catch {
    // Ignore if SQLite is uninitialized
  }

  const mem = process.memoryUsage();
  lines.push(
    '# HELP process_resident_memory_bytes Resident memory size in bytes',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${mem.rss}`,
    '# HELP nodejs_heap_size_used_bytes Process heap space used in bytes',
    '# TYPE nodejs_heap_size_used_bytes gauge',
    `nodejs_heap_size_used_bytes ${mem.heapUsed}`,
    '# HELP monopulse_process_uptime_seconds Process uptime in seconds',
    '# TYPE monopulse_process_uptime_seconds gauge',
    `monopulse_process_uptime_seconds ${Math.round(process.uptime())}`
  );

  return `${lines.join('\n')}\n`;
}

export function traceContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingTraceparent = req.header('traceparent');
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const traceparent =
    incomingTraceparent && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(incomingTraceparent)
      ? incomingTraceparent
      : `00-${traceId}-${spanId}-01`;

  res.setHeader('traceparent', traceparent);
  res.setHeader('X-Trace-Id', traceparent.split('-')[1] || traceId);

  res.on('finish', () => {
    incrementHttpMetric(req.method, req.route?.path || req.path, res.statusCode);
  });

  next();
}

/**
 * Real-Time Server-Sent Events (SSE) Broadcast Bus with Last-Event-ID Replay Buffer & Heartbeat
 */
const sseClients = new Set<Response>();
const MAX_SSE_CLIENTS = 100;
let sseEventCounter = 1;
const sseReplayBuffer: { id: number; eventType: string; data: string }[] = [];

export function registerSseClient(req: Request, res: Response): void {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({ status: 'SSE_CAPACITY_REACHED', error: 'Max SSE clients reached' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(
    `id: 0\nevent: connected\ndata: ${JSON.stringify({ status: 'SSE_STREAM_ACTIVE', timestamp: new Date().toISOString() })}\n\n`
  );

  const lastEventIdHeader = req.header('Last-Event-ID');
  if (lastEventIdHeader) {
    const lastId = Number(lastEventIdHeader);
    if (Number.isFinite(lastId)) {
      for (const item of sseReplayBuffer) {
        if (item.id > lastId) {
          res.write(`id: ${item.id}\nevent: ${item.eventType}\ndata: ${item.data}\n\n`);
        }
      }
    }
  }

  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20_000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function broadcastSseEvent(eventType: string, payload: Record<string, unknown>): void {
  const id = sseEventCounter++;
  const data = JSON.stringify(payload);
  sseReplayBuffer.push({ id, eventType, data });
  if (sseReplayBuffer.length > 50) {
    sseReplayBuffer.shift();
  }

  const frame = `id: ${id}\nevent: ${eventType}\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}
