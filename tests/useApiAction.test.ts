// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { THEME } from '../src/theme.ts';
import { executeJsonRequest, useApiAction } from '../src/hooks/useApiAction.ts';

describe('Shared UI Theme Tokens & useApiAction Hook (Rec 06)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exports shared Tailwind surface and button class tokens in THEME', () => {
    expect(THEME.SURFACE_CARD).toContain('#111827');
    expect(THEME.SURFACE_CARD).toContain('#1F2937');
    expect(THEME.SURFACE_DARK).toContain('#0B0F17');
    expect(THEME.BTN_PRIMARY).toContain('#3B82F6');
  });

  it('executes JSON requests and manages loading, data, and error states in useApiAction', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ matches: [{ id: 'PB-LEDGER-CANARY-01' }] })
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useApiAction<{ matches: { id: string }[] }>());
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    await act(async () => {
      await result.current.runAction('/api/memory/search', {
        method: 'POST',
        body: { query: 'PgBouncer saturation', topK: 3 }
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.matches[0].id).toBe('PB-LEDGER-CANARY-01');
  });

  it('captures HTTP and network errors cleanly in useApiAction and executeJsonRequest', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'VALIDATION_ERROR' })
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useApiAction());
    await act(async () => {
      await result.current.runAction('/api/memory/search', { method: 'POST', body: {} });
    });
    expect(result.current.error).toBe('VALIDATION_ERROR');

    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Socket hang up')) as unknown as typeof fetch;
    await act(async () => {
      const res = await result.current.runAction('/api/integrations');
      expect(res).toBeNull();
    });
    expect(result.current.error).toBe('Socket hang up');

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' })
    }) as unknown as typeof fetch;
    const direct = await executeJsonRequest('/api/health');
    expect(direct.ok).toBe(true);
    expect(direct.data.status).toBe('ok');
  });
});
