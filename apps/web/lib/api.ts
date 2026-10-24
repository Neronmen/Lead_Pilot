import { errorBodySchema, healthResponseSchema, type HealthResponse } from '@leadpilot/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** An error the API reported with its `{ error: { code, message } }` envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API could not be reached at all (down, wrong URL, CORS). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`Cannot reach the API at ${API_URL}`, { cause });
    this.name = 'NetworkError';
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...init?.headers },
    });
  } catch (err) {
    throw new NetworkError(err);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? new ApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      )
    : new ApiError(res.status, 'UNKNOWN', `Unexpected ${res.status} response`);
}

/**
 * Health endpoints answer 503 with the health shape (not the error envelope)
 * when a dependency is down, so both 200 and 503 are valid results here.
 */
export async function fetchHealth(probe: 'live' | 'ready'): Promise<HealthResponse> {
  const res = await request(`/health/${probe}`, { cache: 'no-store' });
  if (res.status !== 200 && res.status !== 503) throw await toApiError(res);
  return healthResponseSchema.parse(await res.json());
}
