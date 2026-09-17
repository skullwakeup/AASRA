/**
 * The single place the frontend talks to the AASRA backend.
 *
 *   GET  /health        -> HealthResponse
 *   POST /api/analyze   -> AnalysisResponse   (multipart field name: `image`)
 *
 * The multipart field name `image` is fixed by the backend signature
 * `async def analyze(image: UploadFile = File(...))` in backend/app/main.py.
 */

import type {
  AnalysisResponse,
  ApiErrorBody,
  HealthResponse,
} from "@/types/api";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

/** The multipart form field the backend expects. Do not change. */
export const UPLOAD_FIELD_NAME = "image";

/**
 * A user-presentable failure. `code` is the backend error code when the
 * backend produced one (e.g. CORRUPT_IMAGE), or a client-side marker.
 */
export class AasraApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.name = "AasraApiError";
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE =
  "Could not reach the AASRA analysis service. Check that the backend is running and reachable.";

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  return typeof (error as { message?: unknown }).message === "string";
}

/** Turn any non-2xx response into an AasraApiError with a clean message. */
async function toApiError(response: Response): Promise<AasraApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error body (proxy page, HTML 502, empty response).
  }

  if (isApiErrorBody(body)) {
    return new AasraApiError(
      body.error.message,
      body.error.code || "API_ERROR",
      response.status,
    );
  }

  if (response.status >= 500) {
    return new AasraApiError(
      "The analysis service encountered an internal error while processing this image.",
      "SERVER_ERROR",
      response.status,
    );
  }

  return new AasraApiError(
    "The analysis request was rejected by the service.",
    "REQUEST_REJECTED",
    response.status,
  );
}

/** Liveness probe for the status indicator. Never throws. */
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as HealthResponse;
    return body?.success ? body : null;
  } catch {
    return null;
  }
}

/**
 * Upload one image for analysis.
 * Throws AasraApiError — the message is always safe to show to a user.
 */
export async function analyzeImage(
  file: File,
  signal?: AbortSignal,
): Promise<AnalysisResponse> {
  const formData = new FormData();
  formData.append(UPLOAD_FIELD_NAME, file, file.name);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AasraApiError("Analysis cancelled.", "CANCELLED");
    }
    throw new AasraApiError(NETWORK_MESSAGE, "NETWORK_ERROR");
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  let payload: AnalysisResponse;
  try {
    payload = (await response.json()) as AnalysisResponse;
  } catch {
    throw new AasraApiError(
      "The analysis service returned a response that could not be read.",
      "MALFORMED_RESPONSE",
      response.status,
    );
  }

  if (!payload?.success || !payload.metrics) {
    throw new AasraApiError(
      "The analysis completed but returned no usable results.",
      "EMPTY_RESULT",
      response.status,
    );
  }

  // A backend older than the storage/drop-zone release omits these fields;
  // fail with a clear message instead of rendering a broken dashboard.
  if (!Array.isArray(payload.storage_zones) || !payload.parameters?.storage) {
    throw new AasraApiError(
      "The analysis service is running an older version. Update the backend, then try again.",
      "INCOMPATIBLE_BACKEND",
      response.status,
    );
  }

  return payload;
}
