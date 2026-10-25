import crypto from 'node:crypto';
import { getSqliteDb } from './sqliteEngine.ts';
import type { MCPWireFrame } from './mcpTypes.ts';

let ledgerInitialized = false;

export function ensureDurableLedgerTables(): void {
  const db = getSqliteDb();
  if (ledgerInitialized) {
    try {
      db.prepare('SELECT 1 FROM audit_hash_chain LIMIT 1').get();
      return;
    } catch {
      ledgerInitialized = false;
    }
  }

  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS audit_hash_chain (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      frame_id TEXT NOT NULL UNIQUE,
      timestamp TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      caller_role TEXT NOT NULL,
      status TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      row_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      dlq_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      error_reason TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING_RETRY',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS step_checkpoints (
      checkpoint_key TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quorum_approvals (
      event_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      caller_role TEXT NOT NULL,
      signature_hmac TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      PRIMARY KEY (event_id, operator_id)
    );

    CREATE TABLE IF NOT EXISTS durable_ambient_events (
      event_id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      event_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS durable_playbooks (
      playbook_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      win_rate_pct REAL NOT NULL,
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      playbook_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS durable_redis_ttl (
      key TEXT PRIMARY KEY,
      ttl_seconds INTEGER NOT NULL,
      expires_at_epoch INTEGER NOT NULL,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ledgerInitialized = true;
}

const GENESIS_HASH = '0'.repeat(64);

export function computeAuditRowHash(params: {
  prevHash: string;
  frameId: string;
  timestamp: string;
  toolName: string;
  callerRole: string;
  status: string;
}): string {
  const canonical = `${params.prevHash}|${params.frameId}|${params.timestamp}|${params.toolName}|${params.callerRole}|${params.status}`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function appendHashChainAuditRow(frame: MCPWireFrame): {
  prevHash: string;
  rowHash: string;
} {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const lastRow = db
    .prepare('SELECT row_hash FROM audit_hash_chain ORDER BY seq DESC LIMIT 1')
    .get();
  const prevHash = lastRow ? String(lastRow.row_hash) : GENESIS_HASH;
  const rowHash = computeAuditRowHash({
    prevHash,
    frameId: frame.frameId,
    timestamp: frame.timestamp,
    toolName: frame.toolName,
    callerRole: frame.callerRole,
    status: frame.status
  });

  db.prepare(
    `INSERT OR IGNORE INTO audit_hash_chain (frame_id, timestamp, tool_name, caller_role, status, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    frame.frameId,
    frame.timestamp,
    frame.toolName,
    frame.callerRole,
    frame.status,
    prevHash,
    rowHash
  );

  return { prevHash, rowHash };
}

export function verifyAuditHashChain(): {
  valid: boolean;
  verifiedRows: number;
  genesisHash: string;
  headHash: string;
  tamperedFrameId: string | null;
} {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const rows = db
    .prepare(
      'SELECT seq, frame_id, timestamp, tool_name, caller_role, status, prev_hash, row_hash FROM audit_hash_chain ORDER BY seq ASC'
    )
    .all();

  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    const actualPrev = String(row.prev_hash);
    const recomputed = computeAuditRowHash({
      prevHash: expectedPrev,
      frameId: String(row.frame_id),
      timestamp: String(row.timestamp),
      toolName: String(row.tool_name),
      callerRole: String(row.caller_role),
      status: String(row.status)
    });
    if (actualPrev !== expectedPrev || String(row.row_hash) !== recomputed) {
      return {
        valid: false,
        verifiedRows: rows.length,
        genesisHash: GENESIS_HASH,
        headHash: String(rows[rows.length - 1]?.row_hash || GENESIS_HASH),
        tamperedFrameId: String(row.frame_id)
      };
    }
    expectedPrev = recomputed;
  }

  return {
    valid: true,
    verifiedRows: rows.length,
    genesisHash: GENESIS_HASH,
    headHash: expectedPrev,
    tamperedFrameId: null
  };
}

export function saveStepCheckpoint(
  eventId: string,
  stepName: string,
  output: Record<string, any>
): void {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const key = `${eventId}:${stepName}`;
  db.prepare(
    `INSERT OR REPLACE INTO step_checkpoints (checkpoint_key, event_id, step_name, output_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(key, eventId, stepName, JSON.stringify(output), new Date().toISOString());
}

export function getStepCheckpoint(
  eventId: string,
  stepName: string
): Record<string, any> | null {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const row = db
    .prepare('SELECT output_json FROM step_checkpoints WHERE checkpoint_key = ?')
    .get(`${eventId}:${stepName}`);
  if (!row) return null;
  try {
    return JSON.parse(String(row.output_json));
  } catch {
    return null;
  }
}

export function enqueueDlqEntry(params: {
  source: string;
  payload: Record<string, any>;
  errorReason: string;
}): { dlqId: string; status: string } {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const dlqId = `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(
    `INSERT INTO dead_letter_queue (dlq_id, source, payload_json, error_reason, retry_count, status, created_at)
     VALUES (?, ?, ?, ?, 0, 'PENDING_RETRY', ?)`
  ).run(dlqId, params.source, JSON.stringify(params.payload), params.errorReason, new Date().toISOString());
  return { dlqId, status: 'PENDING_RETRY' };
}

export function listDlqEntries(): Record<string, any>[] {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  return db
    .prepare('SELECT * FROM dead_letter_queue ORDER BY created_at DESC LIMIT 50')
    .all()
    .map((r) => ({
      dlqId: String(r.dlq_id),
      source: String(r.source),
      payload: JSON.parse(String(r.payload_json || '{}')),
      errorReason: String(r.error_reason),
      retryCount: Number(r.retry_count),
      status: String(r.status),
      createdAt: String(r.created_at)
    }));
}

export function markDlqRetried(dlqId: string): boolean {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const res = db
    .prepare(
      `UPDATE dead_letter_queue SET retry_count = retry_count + 1, status = 'REPLAYED_RESOLVED' WHERE dlq_id = ?`
    )
    .run(dlqId);
  return Number(res.changes) > 0;
}

export function recordQuorumApprovalSignature(params: {
  eventId: string;
  operatorId: string;
  callerRole: string;
}): {
  eventId: string;
  signaturesCollected: number;
  requiredSignatures: number;
  quorumMet: boolean;
  signers: string[];
} {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const sig = crypto
    .createHash('sha256')
    .update(`${params.eventId}:${params.operatorId}:${params.callerRole}`)
    .digest('hex')
    .slice(0, 24);
  db.prepare(
    `INSERT OR REPLACE INTO quorum_approvals (event_id, operator_id, caller_role, signature_hmac, signed_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(params.eventId, params.operatorId, params.callerRole, sig, new Date().toISOString());

  const rows = db
    .prepare('SELECT operator_id FROM quorum_approvals WHERE event_id = ?')
    .all(params.eventId);
  const signers = rows.map((r) => String(r.operator_id));
  return {
    eventId: params.eventId,
    signaturesCollected: signers.length,
    requiredSignatures: 2,
    quorumMet: signers.length >= 2,
    signers
  };
}

export function persistAmbientEventToSqlite(event: {
  eventId: string;
  service: string;
  status: string;
  [k: string]: any;
}): void {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  db.prepare(
    `INSERT OR REPLACE INTO durable_ambient_events (event_id, service, status, event_json, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(event.eventId, event.service, event.status, JSON.stringify(event), new Date().toISOString());
}

export function persistPlaybookToSqlite(
  playbook: { id: string; title: string; stepReductionPct?: number; winRatePct?: number; [k: string]: any },
  upvotes = 0,
  downvotes = 0
): void {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  db.prepare(
    `INSERT OR REPLACE INTO durable_playbooks (playbook_id, title, win_rate_pct, upvotes, downvotes, playbook_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    playbook.id,
    playbook.title,
    playbook.stepReductionPct ?? playbook.winRatePct ?? 35,
    upvotes,
    downvotes,
    JSON.stringify(playbook),
    new Date().toISOString()
  );
}

export function persistRedisTtlToSqlite(entry: {
  key: string;
  ttlSeconds?: number;
  ttlRemainingSec?: number;
  value?: any;
  valueSummary?: string;
  lastAccessedAt?: string;
  updatedAt?: string;
}): void {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = entry.ttlSeconds ?? entry.ttlRemainingSec ?? 900;
  db.prepare(
    `INSERT OR REPLACE INTO durable_redis_ttl (key, ttl_seconds, expires_at_epoch, summary, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    entry.key,
    ttl,
    nowSec + ttl,
    entry.valueSummary || JSON.stringify(entry.value || {}),
    entry.updatedAt || entry.lastAccessedAt || new Date().toISOString()
  );
}

export function sanitizeCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function pruneAuditLogRetention(maxRows = 5000): number {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const res = db
    .prepare(
      `DELETE FROM mcp_audit_log WHERE frame_id NOT IN (
         SELECT frame_id FROM mcp_audit_log ORDER BY timestamp DESC LIMIT ?
       )`
    )
    .run(maxRows);
  return Number(res.changes || 0);
}

export function exportSqliteSnapshotJson(): Record<string, any> {
  ensureDurableLedgerTables();
  const db = getSqliteDb();
  const chainStatus = verifyAuditHashChain();
  return {
    exportedAt: new Date().toISOString(),
    hashChainIntegrity: chainStatus,
    deployments: db.prepare('SELECT * FROM deployments').all(),
    serviceIncidents: db.prepare('SELECT * FROM service_incidents').all(),
    featureFlags: db.prepare('SELECT * FROM feature_flags').all(),
    deadLetterQueue: listDlqEntries()
  };
}
