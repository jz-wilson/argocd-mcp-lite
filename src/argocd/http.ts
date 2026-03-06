import { logger } from '../logging/logging.js';

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

type SearchParams = Record<string, string | number | boolean | undefined | null> | null;

export class ArgocdApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly responseBody: unknown;

  constructor(status: number, endpoint: string, responseBody: unknown) {
    const bodyMsg =
      typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody
        ? (responseBody as { message: string }).message
        : JSON.stringify(responseBody);
    super(`ArgoCD API error ${status} on ${endpoint}: ${bodyMsg}`);
    this.name = 'ArgocdApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

export interface HttpClientOptions {
  maxRetries?: number;
  requestTimeoutMs?: number;
  streamTimeoutMs?: number;
}

export class HttpClient {
  public readonly baseUrl: string;
  public readonly apiToken: string;
  public readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly streamTimeoutMs: number;

  constructor(baseUrl: string, apiToken: string, options?: HttpClientOptions) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.headers = {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    };
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.streamTimeoutMs = options?.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ArgocdApiError) {
      return RETRYABLE_STATUS_CODES.has(error.status);
    }
    // Network errors (fetch failures, DNS, connection refused) are retryable
    return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError');
  }

  private async withRetry<T>(fn: () => Promise<T>, endpoint: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const start = Date.now();
        const result = await fn();
        logger.debug({ endpoint, durationMs: Date.now() - start, attempt }, 'request succeeded');
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && this.isRetryable(error)) {
          const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          logger.warn(
            { endpoint, attempt, delayMs, error: String(error) },
            'retrying after transient error'
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        logger.error({ endpoint, attempt, error: String(error) }, 'request failed');
        throw error;
      }
    }
    throw lastError;
  }

  private async request<R>(
    url: string,
    params?: SearchParams,
    init?: RequestInit
  ): Promise<HttpResponse<R>> {
    const urlObject = this.absUrl(url);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        urlObject.searchParams.set(key, value?.toString() || '');
      });
    }

    const endpoint = `${init?.method ?? 'GET'} ${url}`;

    return this.withRetry(async () => {
      const response = await fetch(urlObject, {
        ...init,
        headers: { ...init?.headers, ...this.headers },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = await response.text().catch(() => 'unable to read response body');
        }
        throw new ArgocdApiError(response.status, endpoint, body);
      }

      const body = await response.json();
      return {
        status: response.status,
        headers: response.headers,
        body: body as R
      };
    }, endpoint);
  }

  private async requestStream<R>(
    url: string,
    params?: SearchParams,
    cb?: (chunk: R) => void,
    init?: RequestInit
  ) {
    const urlObject = this.absUrl(url);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        urlObject.searchParams.set(key, value?.toString() || '');
      });
    }

    const endpoint = `GET(stream) ${url}`;

    await this.withRetry(async () => {
      const response = await fetch(urlObject, {
        ...init,
        headers: { ...init?.headers, ...this.headers },
        signal: AbortSignal.timeout(this.streamTimeoutMs)
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = await response.text().catch(() => 'unable to read response body');
        }
        throw new ArgocdApiError(response.status, endpoint, body);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('response body is not readable');
      }
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const json = JSON.parse(line);
            cb?.(json['result']);
          }
        }
      }
    }, endpoint);
  }

  absUrl(url: string): URL {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url);
    }
    return new URL(url, this.baseUrl);
  }

  async get<R>(url: string, params?: SearchParams): Promise<HttpResponse<R>> {
    const response = await this.request<R>(url, params);
    return response;
  }

  async getStream<R>(url: string, params?: SearchParams, cb?: (chunk: R) => void): Promise<void> {
    await this.requestStream<R>(url, params, cb);
  }

  async post<T, R>(url: string, params?: SearchParams, body?: T): Promise<HttpResponse<R>> {
    const response = await this.request<R>(url, params, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
    return response;
  }

  async put<T, R>(url: string, params?: SearchParams, body?: T): Promise<HttpResponse<R>> {
    const response = await this.request<R>(url, params, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    });
    return response;
  }

  async delete<R>(url: string, params?: SearchParams): Promise<HttpResponse<R>> {
    const response = await this.request<R>(url, params, {
      method: 'DELETE'
    });
    return response;
  }
}
