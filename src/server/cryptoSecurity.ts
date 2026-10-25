import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RBACRole } from './mcpTypes.ts';

const DEFAULT_WEBHOOK_SECRET =
  process.env.MONOPULSE_WEBHOOK_SECRET || 'monopulse-prod-hmac-secret-key-2026';
const DEFAULT_APPROVAL_SECRET =
  process.env.MONOPULSE_APPROVAL_SECRET || 'monopulse-approval-token-hmac-key-2026';
const PREVIOUS_ROTATED_SECRET =
  process.env.MONOPULSE_PREVIOUS_SECRET || 'monopulse-rotated-hmac-key-2025-q4';

const revokedTokens = new Set<string>();

export function revokeSecurityToken(tokenOrId: string): { revoked: boolean; count: number } {
  const cleaned = tokenOrId.trim();
  if (cleaned) {
    revokedTokens.add(cleaned);
  }
  return { revoked: Boolean(cleaned), count: revokedTokens.size };
}

export function isSecurityTokenRevoked(tokenOrId: string): boolean {
  return revokedTokens.has(tokenOrId.trim());
}

export function evaluateAbacPolicy(params: {
  callerRole: RBACRole;
  toolName: string;
  isMutation: boolean;
  args: Record<string, unknown>;
}): { allowed: boolean; policyId: string; reason: string } {
  const serviceArg = String(params.args.service || params.args.targetService || '');
  const blackoutWindow = Boolean(params.args.blackoutWindow);

  if (params.isMutation && serviceArg === 'payment-vault-prod' && params.callerRole !== 'sre_admin') {
    return {
      allowed: false,
      policyId: 'ABAC-TIER0-VAULT-GUARD',
      reason: `Tier-0 service 'payment-vault-prod' requires 'sre_admin' for mutations (caller: '${params.callerRole}')`
    };
  }

  if (params.isMutation && blackoutWindow && params.callerRole !== 'sre_admin') {
    return {
      allowed: false,
      policyId: 'ABAC-CHANGE-FREEZE-WINDOW',
      reason: 'Mutations during active change-freeze window require sre_admin break-glass privilege'
    };
  }

  return {
    allowed: true,
    policyId: 'ABAC-DEFAULT-ALLOW',
    reason: 'Contextual resource and environment attributes satisfied'
  };
}

export function canonicalizeJson(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const obj = input as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function computeWebhookSignature(
  payload: string | Record<string, unknown>,
  secret: string = DEFAULT_WEBHOOK_SECRET
): string {
  const serialized = typeof payload === 'string' ? payload : canonicalizeJson(payload);
  const digest = crypto.createHmac('sha256', secret).update(serialized, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  payload: string | Record<string, unknown>,
  signatureHeader: string,
  secret: string = DEFAULT_WEBHOOK_SECRET
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const secretsToTry = [secret, PREVIOUS_ROTATED_SECRET];
  const providedBuf = Buffer.from(signatureHeader.trim(), 'utf8');

  for (const candidateSecret of secretsToTry) {
    const expected = computeWebhookSignature(payload, candidateSecret);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return true;
    }
  }
  return false;
}

export function verifyWebhookReplayWindow(
  timestampHeader: string | undefined,
  maxSkewSeconds = 300
): { valid: boolean; reason?: string } {
  if (!timestampHeader) {
    return { valid: true };
  }
  const parsed = Number(timestampHeader);
  if (!Number.isFinite(parsed)) {
    return { valid: false, reason: 'Malformed X-MonoPulse-Timestamp header' };
  }
  const tsSeconds = parsed > 1e11 ? Math.floor(parsed / 1000) : parsed;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSeconds - tsSeconds);
  if (skew > maxSkewSeconds) {
    return {
      valid: false,
      reason: `Webhook timestamp skew (${skew}s) exceeds ${maxSkewSeconds}s replay window`
    };
  }
  return { valid: true };
}

export function signRoleBearerToken(
  role: RBACRole,
  secret: string = DEFAULT_APPROVAL_SECRET
): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`role:${role}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `mp_role_v1.${role}.${sig}`;
}

export function resolveVerifiedCallerRole(
  authHeader: string | undefined,
  fallbackRole: RBACRole = 'readonly_analyst',
  secret: string = DEFAULT_APPROVAL_SECRET
): { role: RBACRole; verifiedFromBearer: boolean; error?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { role: fallbackRole, verifiedFromBearer: false };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (isSecurityTokenRevoked(token)) {
    return {
      role: 'readonly_analyst',
      verifiedFromBearer: false,
      error: 'Bearer RBAC token has been revoked via JTI denylist'
    };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mp_role_v1') {
    return {
      role: 'readonly_analyst',
      verifiedFromBearer: false,
      error: 'Malformed Bearer RBAC token'
    };
  }
  const roleCandidate = parts[1] as RBACRole;
  const providedSig = parts[2];

  for (const candidateSecret of [secret, PREVIOUS_ROTATED_SECRET]) {
    const expectedSig = crypto
      .createHmac('sha256', candidateSecret)
      .update(`role:${roleCandidate}`, 'utf8')
      .digest('hex')
      .slice(0, 24);
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const providedBuf = Buffer.from(providedSig, 'utf8');
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { role: roleCandidate, verifiedFromBearer: true };
    }
  }

  return {
    role: 'readonly_analyst',
    verifiedFromBearer: false,
    error: 'Invalid Bearer RBAC token signature'
  };
}

export function signApprovalToken(params: {
  eventId?: string;
  toolName: string;
  args: Record<string, unknown>;
  ttlMs?: number;
  secret?: string;
}): string {
  const secret = params.secret || DEFAULT_APPROVAL_SECRET;
  const expiresAt = Date.now() + (params.ttlMs ?? 3600_000);
  const canonicalArgs = canonicalizeJson(params.args);
  const argsDigest = crypto
    .createHash('sha256')
    .update(canonicalArgs, 'utf8')
    .digest('hex')
    .slice(0, 12);

  const signingInput = `v1:${params.toolName}:${expiresAt}:${argsDigest}`;
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(signingInput, 'utf8')
    .digest('hex')
    .slice(0, 24);

  return `mp_sig_v1.${expiresAt}.${argsDigest}.${hmac}`;
}

export function verifyApprovalToken(params: {
  token: string;
  toolName: string;
  args: Record<string, unknown>;
  secret?: string;
}): { valid: boolean; cryptographic: boolean; reason?: string; expiresAt?: number } {
  const { token, toolName, args } = params;
  const secret = params.secret || DEFAULT_APPROVAL_SECRET;

  if (!token) {
    return { valid: false, cryptographic: false, reason: 'Missing approval token' };
  }

  if (isSecurityTokenRevoked(token)) {
    return {
      valid: false,
      cryptographic: true,
      reason: 'Approval token has been explicitly revoked'
    };
  }

  if (token.startsWith('MP-SIG-')) {
    return { valid: true, cryptographic: false };
  }

  if (!token.startsWith('mp_sig_v1.')) {
    return { valid: false, cryptographic: true, reason: 'Malformed approval token version prefix' };
  }

  const segments = token.split('.');
  if (segments.length !== 4) {
    return { valid: false, cryptographic: true, reason: 'Invalid approval token structure' };
  }

  const expiresAt = Number(segments[1]);
  const providedArgsDigest = segments[2];
  const providedHmac = segments[3];

  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, cryptographic: true, reason: 'Approval token has expired', expiresAt };
  }

  const canonicalArgs = canonicalizeJson(args);
  const actualArgsDigest = crypto
    .createHash('sha256')
    .update(canonicalArgs, 'utf8')
    .digest('hex')
    .slice(0, 12);

  if (actualArgsDigest !== providedArgsDigest) {
    return {
      valid: false,
      cryptographic: true,
      reason: 'Mutation arguments were tampered with after token issuance'
    };
  }

  const signingInput = `v1:${toolName}:${expiresAt}:${actualArgsDigest}`;
  for (const candidateSecret of [secret, PREVIOUS_ROTATED_SECRET]) {
    const expectedHmac = crypto
      .createHmac('sha256', candidateSecret)
      .update(signingInput, 'utf8')
      .digest('hex')
      .slice(0, 24);
    const expectedBuf = Buffer.from(expectedHmac, 'utf8');
    const providedBuf = Buffer.from(providedHmac, 'utf8');
    if (
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { valid: true, cryptographic: true, expiresAt };
    }
  }

  return { valid: false, cryptographic: true, reason: 'Invalid HMAC-SHA256 signature on token' };
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com data: blob:;"
  );
  next();
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function createRateLimitMiddleware(maxRequestsPerMinute = 240) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isMutationRoute =
      req.method === 'POST' &&
      (req.path.includes('/webhooks') ||
        req.path.includes('/approve') ||
        req.path.includes('/distill'));
    const effectiveLimit = isMutationRoute
      ? Math.min(maxRequestsPerMinute, 120)
      : maxRequestsPerMinute;
    const bucketKey = `${req.ip || '127.0.0.1'}:${isMutationRoute ? 'mut' : 'read'}`;
    const now = Date.now();

    if (rateBuckets.size > 500) {
      for (const [k, v] of rateBuckets.entries()) {
        if (now > v.resetAt) rateBuckets.delete(k);
      }
    }

    const existing = rateBuckets.get(bucketKey);
    if (!existing || now > existing.resetAt) {
      const resetAt = now + 60_000;
      rateBuckets.set(bucketKey, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', String(effectiveLimit));
      res.setHeader('X-RateLimit-Remaining', String(effectiveLimit - 1));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      next();
      return;
    }

    existing.count += 1;
    const remaining = Math.max(0, effectiveLimit - existing.count);
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    res.setHeader('X-RateLimit-Limit', String(effectiveLimit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));

    if (existing.count > effectiveLimit) {
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        status: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: retryAfterSec,
        error: 'Too many requests in 60s window. Please retry shortly.'
      });
      return;
    }

    next();
  };
}
