import { z } from "zod";
import { assertSafeProviderOrigin } from "@/lib/security/run-policy";

export const JUDGE_PROVIDER_TIMEOUT_MS = 45_000;
export const KIMI_K3_REASONING_EFFORT = "low" as const;
export const MAX_JUDGE_PROVIDER_IMAGES = 16;

const providerResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.object({ content: z.string().min(2).max(100_000) }),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();

export type PinnedJudgeInput = {
  endpointOrigin: string;
  images: readonly string[];
  maxTokens: number;
  model: string;
  prompt: string;
  provider: string;
};

type ProviderDependencies = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function buildJudgeMessageContent(
  prompt: string,
  images: readonly string[],
  provider = "openai-compatible",
) {
  if (images.length > MAX_JUDGE_PROVIDER_IMAGES) {
    throw new JudgeProviderContractError("judge_image_count_exceeded");
  }
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
  ];
  for (const image of images) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(image)) {
      throw new JudgeProviderContractError("judge_image_url_invalid");
    }
    content.push({
      type: "image_url",
      image_url: isMoonshotProvider(provider)
        ? { url: image }
        : { url: image, detail: "high" },
    });
  }
  return content;
}

export function buildPinnedJudgeRequest(input: PinnedJudgeInput) {
  const content = buildJudgeMessageContent(
    input.prompt,
    input.images,
    input.provider,
  );
  const request = {
    model: input.model,
    messages: [{ role: "user", content }],
    max_completion_tokens: input.maxTokens,
    response_format: { type: "json_object" },
  };
  if (isMoonshotProvider(input.provider)) {
    if (input.model !== "kimi-k3") {
      throw new JudgeConfigurationError("judgeModelVersion");
    }
    return { ...request, reasoning_effort: KIMI_K3_REASONING_EFFORT };
  }
  return { ...request, temperature: 0 };
}

export function hasImmutableJudgeModelVersion(
  provider: string,
  modelVersion: string,
) {
  return !(isMoonshotProvider(provider) && modelVersion === "kimi-k3");
}

export function judgeCalibrationDisposition(input: {
  modelVersion: string;
  provider: string;
  status: "active" | "draft";
}) {
  const immutable = hasImmutableJudgeModelVersion(
    input.provider,
    input.modelVersion,
  );
  if (input.status === "active") return immutable ? "pass" : "freeze";
  return immutable ? "activate" : "candidate-only";
}

function isMoonshotProvider(provider: string) {
  return provider.trim().toLowerCase() === "moonshot";
}

export async function callPinnedJudge(
  input: PinnedJudgeInput,
  dependencies: ProviderDependencies = {},
) {
  let origin: URL;
  try {
    origin = assertSafeProviderOrigin(input.endpointOrigin);
  } catch {
    throw new JudgeConfigurationError("judgeEndpointOrigin");
  }
  const timeoutMs = dependencies.timeoutMs ?? JUDGE_PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new JudgeConfigurationError("judgeProviderTimeoutMs");
  }
  const endpoint = new URL("/v1/chat/completions", origin);
  const request = buildPinnedJudgeRequest(input);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dependencies.apiKey ?? requiredSecret("JUDGE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal.aborted || isTimeoutError(error)) {
      throw new JudgeProviderTimeoutError(timeoutMs);
    }
    throw new JudgeProviderError(0);
  }
  if (!response.ok) throw new JudgeProviderError(response.status);
  const raw = providerResponseSchema.parse(await response.json());
  return {
    content: raw.choices[0].message.content,
    inputTokens: raw.usage?.prompt_tokens ?? null,
    outputTokens: raw.usage?.completion_tokens ?? null,
  };
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value || value.length > 4096) throw new JudgeConfigurationError(name);
  return value;
}

export class JudgeProviderContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("The pinned judge request is outside the published media contract.");
    this.name = "JudgeProviderContractError";
    this.code = code;
  }
}

export class JudgeConfigurationError extends Error {
  readonly code = "judge_configuration_error";

  constructor(readonly key: string) {
    super("The pinned judge is not configured.");
    this.name = "JudgeConfigurationError";
  }
}

export class JudgeProviderError extends Error {
  readonly code: string;

  constructor(readonly status: number) {
    super("The pinned judge provider did not complete the request.");
    this.name = "JudgeProviderError";
    this.code = status > 0 ? `judge_provider_http_${status}` : "judge_provider_network";
  }
}

export class JudgeProviderTimeoutError extends Error {
  readonly code = "judge_provider_timeout";

  constructor(readonly timeoutMs: number) {
    super("The pinned judge provider exceeded the bounded request timeout.");
    this.name = "JudgeProviderTimeoutError";
  }
}
