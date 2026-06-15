import Constants from 'expo-constants';

/**
 * API client — fetch wrapper z auth, error handling.
 *
 * BASE URL z `app.json#extra.apiBaseUrl` (możliwy override per env w EAS build).
 * W production powinno wskazywać na Railway URL (https://nieruchomosciai.up.railway.app)
 * albo custom domain.
 */

const BASE_URL = (Constants.expoConfig?.extra?.apiBaseUrl ?? 'http://localhost:3000') as string;

let _token: string | null = null;

export function setAuthToken(token: string | null) {
  _token = token;
}

export function getAuthToken(): string | null {
  return _token;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiException extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, body: { error?: ApiError } | unknown) {
    const error = (body as { error?: ApiError })?.error;
    super(error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = error?.code ?? 'HTTP_ERROR';
    this.details = error?.details;
  }
}

interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  authRequired?: boolean;
}

export async function apiCall<T = unknown>(
  path: string,
  opts: ApiRequest = {},
): Promise<T> {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, BASE_URL + '/');
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  // Parse JSON jeśli content-type pasuje.
  let body: unknown = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { body = await res.json(); } catch { /* ignore */ }
  }

  if (!res.ok) throw new ApiException(res.status, body);
  return body as T;
}
