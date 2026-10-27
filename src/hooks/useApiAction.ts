import { useCallback, useState } from 'react';

export interface ApiActionOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export async function executeJsonRequest<T = any>(
  url: string,
  options: ApiActionOptions = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const { method = 'GET', body, headers = {} } = options;
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  };

  const res = await fetch(url, init);
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Reusable React hook encapsulating the fetch / try / finally / setState
 * lifecycle used across MonoPulse operational panels.
 */
export function useApiAction<TData = any>(initialData: TData | null = null) {
  const [data, setData] = useState<TData | null>(initialData);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(async (url: string, options: ApiActionOptions = {}): Promise<TData | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await executeJsonRequest<TData>(url, options);
      setData(result.data);
      if (!result.ok) {
        const errPayload = result.data as Record<string, any> | null;
        setError(errPayload?.error || `HTTP ${result.status}`);
      }
      return result.data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network request failed';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, setData, loading, error, setError, runAction };
}
