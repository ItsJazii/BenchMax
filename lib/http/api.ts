import { ZodError, type ZodType } from "zod";
import { AuthRequiredError } from "@/lib/auth/server";
import {
  AccountUnavailableError,
  ForbiddenError,
  ProfileRequiredError,
} from "@/lib/auth/authorization";
import { RateLimitExceededError } from "@/lib/security/rate-limit";
import { secureJson } from "@/lib/security/http";
import {
  SensitiveContentError,
  ShowcaseNotPublishableError,
} from "@/lib/data/showcases";
import { UploadSessionError } from "@/lib/data/uploads";
import { ReportTargetError } from "@/lib/data/reports";
import { CatalogConfigurationError } from "@/lib/data/catalog-admin";
import {
  RunContractError,
  RunTransitionConflictError,
  RunTransitionError,
} from "@/lib/data/runs";
import {
  InsufficientCreditsError,
  InvalidCreditGrantError,
} from "@/lib/data/credits";
import { UnsafeProviderOriginError } from "@/lib/security/run-policy";

const MAX_JSON_BODY_BYTES = 128 * 1024;

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const lengthHeader = request.headers.get("content-length");
  const contentLength = lengthHeader ? Number(lengthHeader) : null;
  if (
    contentLength !== null &&
    (!Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_JSON_BODY_BYTES)
  ) {
    throw new PayloadTooLargeError();
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") throw new UnsupportedMediaTypeError();

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  return schema.parse(JSON.parse(text));
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return secureJson({ error: "Invalid request payload." }, { status: 400 });
  }
  if (
    error instanceof AuthRequiredError ||
    error instanceof ProfileRequiredError ||
    error instanceof AccountUnavailableError ||
    error instanceof ForbiddenError
  ) {
    return secureJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof RateLimitExceededError) {
    return secureJson(
      {
        error: error.message,
        retryAfter: error.resetsAt.toISOString(),
      },
      {
        status: error.status,
        headers: {
          "Retry-After": Math.max(
            1,
            Math.ceil((error.resetsAt.getTime() - Date.now()) / 1000),
          ).toString(),
        },
      },
    );
  }
  if (
    error instanceof PayloadTooLargeError ||
    error instanceof UnsupportedMediaTypeError
  ) {
    return secureJson({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof SensitiveContentError ||
    error instanceof ShowcaseNotPublishableError ||
    error instanceof UploadSessionError ||
    error instanceof ReportTargetError ||
    error instanceof CatalogConfigurationError ||
    error instanceof RunContractError ||
    error instanceof RunTransitionError ||
    error instanceof RunTransitionConflictError ||
    error instanceof InsufficientCreditsError ||
    error instanceof InvalidCreditGrantError ||
    error instanceof UnsafeProviderOriginError
  ) {
    return secureJson({ error: error.message }, { status: error.status });
  }
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    return secureJson(
      { error: error.message.slice(0, 300) },
      { status: error.status },
    );
  }

  console.error("Benchmax request failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return secureJson({ error: "Request failed." }, { status: 500 });
}

class PayloadTooLargeError extends Error {
  readonly status = 413;

  constructor() {
    super("Request payload is too large.");
    this.name = "PayloadTooLargeError";
  }
}

class UnsupportedMediaTypeError extends Error {
  readonly status = 415;

  constructor() {
    super("Content-Type must be application/json.");
    this.name = "UnsupportedMediaTypeError";
  }
}
