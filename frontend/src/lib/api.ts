import { env } from './env';
import {
  API_PATHS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  HTTP,
} from './constants';
import { useAuthStore } from '@/store/auth';
import type { ApiErrorPayload, AuthTokens } from '@/types';

/* -------------------------------------------------------------------------- */
/*                                  Errors                                    */
/* -------------------------------------------------------------------------- */
/**
 * Thrown for any non-2xx HTTP response the client produces, including
 * network failures (status 0) and timeouts (status 408).
 *
 * The backend standardises error payloads as `{ detail: string, code?: string }`
 * — both fields are surfaced here so UI layers can show `detail` to users
 * and switch on `code` for programmatic handling.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly detail: string;
  public readonly code?: string;

  constructor(status: number, detail: string, code?: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    if (code !== undefined) this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/*                    Single-flight refresh coordination                      */
/* -------------------------------------------------------------------------- */
/**
 * When several in-flight requests all get a 401 simultaneously, we must
 * call `/auth/refresh` exactly once. All other callers await the same
 * promise and then retry their original request.
 */
let refreshPromise: Promise<void> | null = null;

/* -------------------------------------------------------------------------- */
/*                                 Types                                       */
/* -------------------------------------------------------------------------- */
type JsonBody = Record<string, unknown> | unknown[] | null | undefined;

interface RequestOptions {
  /** Override the default 15s abort timeout. */
  timeoutMs?: number;
  /** Extra headers merged onto the defaults. */
  headers?: Record<string, string>;
  /** Skip the Authorization header (useful for public endpoints). */
  skipAuth?: boolean;
  /** Query params appended to the URL. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Internal flag set when replaying a request after a token refresh. */
  _isRetry?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                  Client                                    */
/* -------------------------------------------------------------------------- */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  /** GET request. */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /** POST a JSON body. */
  post<T>(path: string, body?: JsonBody, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  /** PATCH a JSON body. */
  patch<T>(path: string, body?: JsonBody, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  /** DELETE (optionally with body for APIs that require it). */
  delete<T>(
    path: string,
    body?: JsonBody,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('DELETE', path, body, options);
  }

  /**
   * Upload a FormData payload — content-type is delegated to the browser
   * so the correct multipart boundary is emitted.
   */
  upload<T>(
    path: string,
    form: FormData,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, form, options);
  }

  /* ------------------------------ internals ----------------------------- */

  private buildUrl(
    path: string,
    query?: RequestOptions['query'],
  ): string {
    const isAbsolute = /^https?:\/\//i.test(path);
    const base = isAbsolute ? path : `${this.baseUrl}${path}`;
    if (!query) return base;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (!qs) return base;
    return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
  }

  private buildHeaders(
    body: unknown,
    options: RequestOptions | undefined,
  ): Headers {
    const headers = new Headers();

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    headers.set(HTTP.HEADERS.ACCEPT, HTTP.CONTENT_TYPES.JSON);
    if (!isFormData && body !== undefined && body !== null) {
      headers.set(HTTP.HEADERS.CONTENT_TYPE, HTTP.CONTENT_TYPES.JSON);
    }

    if (!options?.skipAuth) {
      const token = useAuthStore.getState().accessToken;
      if (token) headers.set(HTTP.HEADERS.AUTHORIZATION, `Bearer ${token}`);
    }

    if (options?.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        headers.set(k, v);
      }
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body: JsonBody | FormData,
    options?: RequestOptions,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const isFormData =
      typeof FormData !== 'undefined' && body instanceof FormData;
    const serialisedBody =
      body === undefined || body === null
        ? undefined
        : isFormData
          ? (body as FormData)
          : JSON.stringify(body);

    const url = this.buildUrl(path, options?.query);
    const headers = this.buildHeaders(body, options);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: serialisedBody ?? null,
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiError(408, 'Request timed out', 'timeout');
      }
      const message = err instanceof Error ? err.message : 'Network error';
      throw new ApiError(0, message, 'network');
    }
    clearTimeout(timeoutId);

    // 401 handling — attempt silent refresh except on the refresh endpoint itself.
    if (response.status === 401 && !options?._isRetry) {
      if (path.startsWith(API_PATHS.AUTH_REFRESH)) {
        useAuthStore.getState().logout();
        throw await buildApiError(response);
      }

      const refreshed = await this.ensureRefreshed();
      if (!refreshed) {
        throw await buildApiError(response);
      }
      // Retry with the fresh token. Merge-safe: we set `_isRetry` to prevent
      // a refresh loop if the retry also gets 401.
      return this.request<T>(method, path, body, {
        ...options,
        _isRetry: true,
      });
    }

    if (!response.ok) {
      throw await buildApiError(response);
    }

    // 204 No Content — return undefined typed as T.
    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get(HTTP.HEADERS.CONTENT_TYPE) ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    // Fallback — caller asked for T but server returned text. Return undefined.
    return undefined as T;
  }

  /**
   * Kick off `/auth/refresh` exactly once even if many requests 401 together.
   * Returns true if tokens were successfully swapped.
   */
  private async ensureRefreshed(): Promise<boolean> {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return false;

    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const tokens = await this.request<AuthTokens>(
            'POST',
            API_PATHS.AUTH_REFRESH,
            { refreshToken },
            { skipAuth: true, _isRetry: true },
          );
          useAuthStore.getState().updateTokens(tokens);
        } finally {
          refreshPromise = null;
        }
      })();
    }

    try {
      await refreshPromise;
      return true;
    } catch {
      useAuthStore.getState().logout();
      return false;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Error materialiser                            */
/* -------------------------------------------------------------------------- */
async function buildApiError(response: Response): Promise<ApiError> {
  let detail = response.statusText || `HTTP ${response.status}`;
  let code: string | undefined;
  try {
    const contentType = response.headers.get(HTTP.HEADERS.CONTENT_TYPE) ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as Partial<ApiErrorPayload>;
      if (typeof payload.detail === 'string') detail = payload.detail;
      if (typeof payload.code === 'string') code = payload.code;
    } else {
      const text = await response.text();
      if (text) detail = text;
    }
  } catch {
    // Keep statusText fallback.
  }
  return new ApiError(response.status, detail, code);
}

/* -------------------------------------------------------------------------- */
/*                               Default instance                             */
/* -------------------------------------------------------------------------- */
export const api = new ApiClient(env.API_BASE_URL);
