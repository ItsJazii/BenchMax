import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import {
  assertSafeProviderOrigin,
  byokStartMessageSchema,
} from "@/lib/security/run-policy";
import { canonicalJson, canonicalSha256 } from "@/lib/security/canonical";
import { detectSecretLabels, sha256Hex } from "@/lib/security/policy";

const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;

const providerResponseSchema = z
  .object({
    id: z.string().max(500).optional(),
    choices: z
      .array(
        z.object({
          message: z
            .object({
              role: z.literal("assistant").optional(),
              content: z.string().nullable().optional(),
              reasoning_content: z.string().nullable().optional(),
              tool_calls: z
                .array(
                  z.object({
                    id: z.string().min(1).max(500),
                    type: z.literal("function"),
                    function: z.object({
                      name: z.enum(["write_file", "read_file", "list_files"]),
                      arguments: z.string().max(2_000_000),
                    }),
                  }),
                )
                .max(50)
                .optional(),
            })
            .passthrough(),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type AgentMessage = Record<string, unknown> & { role: string };
type FileToolCall = {
  id: string;
  type: "function";
  function: {
    name: "write_file" | "read_file" | "list_files";
    arguments: string;
  };
};

export type GenerationContract = {
  apiStyle: "openai-compatible" | "anthropic-compatible";
  benchmarkPrompt: string;
  configurationId: string;
  endpointOrigin: string;
  environmentHash: string;
  harnessContractHash: string;
  maxProjectBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  providerModelId: string;
  runId: string;
  samplingSettingsJson: string;
  turnLimit: number;
};

export type WebAgentGenerationResult = {
  files: ReadonlyMap<string, string>;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  redactedTranscript: string;
  requestHash: string;
  responseHash: string;
  sourceBytes: Uint8Array;
  sourceSha256: string;
  transcriptEnvelope: unknown;
  turnCount: number;
};

export async function executeWebAgentGeneration(input: {
  apiKey: string;
  contract: GenerationContract;
  onEvent?: (event: { message: string; turn: number; type: string }) => void;
  signal: AbortSignal;
}): Promise<WebAgentGenerationResult> {
  byokStartMessageSchema.parse({ type: "start", apiKey: input.apiKey });
  if (input.contract.apiStyle !== "openai-compatible") {
    throw new GenerationProviderError("unsupported_provider_style");
  }
  const origin = assertSafeProviderOrigin(input.contract.endpointOrigin);
  const endpoint = new URL("/v1/chat/completions", origin);
  const settings = parseSamplingSettings(input.contract.samplingSettingsJson);
  const files = new Map<string, string>();
  const requests: unknown[] = [];
  const responses: unknown[] = [];
  const messages: AgentMessage[] = [
    {
      role: "system",
      content:
        "You are Benchmax Web Agent v1. Build the requested static web project using only the provided file tools. You must create index.html. Use local HTML, CSS, and JavaScript only; dependencies and network access are forbidden. Never include credentials or external URLs. Finish only after the project is complete.",
    },
    { role: "user", content: input.contract.benchmarkPrompt },
  ];
  let inputTokens = 0;
  let outputTokens = 0;
  let providerRequestId: string | null = null;
  let finalContent = "";

  for (let turn = 1; turn <= input.contract.turnLimit; turn += 1) {
    input.onEvent?.({
      type: "turn",
      turn,
      message: `Generation turn ${turn} of ${input.contract.turnLimit}`,
    });
    const body = {
      model: input.contract.providerModelId,
      messages,
      tools: fileTools,
      tool_choice: "auto",
      ...settings,
    };
    requests.push(body);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    providerRequestId ??=
      response.headers.get("x-request-id") ?? response.headers.get("request-id");
    if (!response.ok) {
      throw new GenerationProviderError(`provider_http_${response.status}`);
    }
    const responseText = await readBoundedText(
      response,
      MAX_PROVIDER_RESPONSE_BYTES,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(responseText);
    } catch {
      throw new GenerationProviderError("provider_invalid_json");
    }
    const parsed = providerResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GenerationProviderError("provider_invalid_schema");
    }
    responses.push(parsed.data);
    inputTokens += parsed.data.usage?.prompt_tokens ?? 0;
    outputTokens += parsed.data.usage?.completion_tokens ?? 0;
    const assistant = parsed.data.choices[0]?.message;
    if (!assistant) throw new GenerationProviderError("provider_empty_choice");
    const preservedAssistant: AgentMessage = {
      role: "assistant",
      content: assistant.content ?? "",
    };
    if (assistant.reasoning_content) {
      preservedAssistant.reasoning_content = assistant.reasoning_content;
    }
    if (assistant.tool_calls?.length) {
      preservedAssistant.tool_calls = assistant.tool_calls;
    }
    messages.push(preservedAssistant);

    if (!assistant.tool_calls?.length) {
      finalContent = assistant.content ?? "";
      if (files.has("index.html")) {
        return finalizeResult({
          contract: input.contract,
          files,
          finalContent,
          inputTokens,
          outputTokens,
          providerRequestId: providerRequestId ?? parsed.data.id ?? null,
          requests,
          responses,
          turnCount: turn,
        });
      }
      messages.push({
        role: "user",
        content:
          "The project is not complete because index.html has not been written. Continue using the file tools.",
      });
      continue;
    }

    for (const toolCall of assistant.tool_calls) {
      const result = executeFileTool(toolCall, files, input.contract);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }
  throw new GenerationOutputError("turn_limit_exhausted");
}

async function finalizeResult(input: {
  contract: GenerationContract;
  files: Map<string, string>;
  finalContent: string;
  inputTokens: number;
  outputTokens: number;
  providerRequestId: string | null;
  requests: unknown[];
  responses: unknown[];
  turnCount: number;
}): Promise<WebAgentGenerationResult> {
  const secretLabels = new Set<string>();
  for (const content of input.files.values()) {
    for (const label of detectSecretLabels(content)) secretLabels.add(label);
  }
  if (secretLabels.size > 0) {
    throw new GenerationOutputError("generated_secret_detected");
  }
  const archiveEntries: Record<string, Uint8Array> = {};
  for (const [path, content] of [...input.files.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    archiveEntries[path] = strToU8(content);
  }
  const sourceBytes = zipSync(archiveEntries, { level: 6 });
  const requestHash = await canonicalSha256(input.requests);
  const responseHash = await canonicalSha256(input.responses);
  const sourceSha256 = await sha256Hex(sourceBytes.buffer);
  return {
    files: input.files,
    inputTokens: input.inputTokens || null,
    outputTokens: input.outputTokens || null,
    providerRequestId: input.providerRequestId,
    requestHash,
    responseHash,
    sourceBytes,
    sourceSha256,
    turnCount: input.turnCount,
    redactedTranscript: canonicalJson({
      turnCount: input.turnCount,
      writtenFiles: [...input.files.keys()].sort(),
      finalMessage: input.finalContent.slice(0, 10_000),
    }),
    transcriptEnvelope: {
      version: 1,
      runId: input.contract.runId,
      configurationId: input.contract.configurationId,
      requestBodies: input.requests,
      responseBodies: input.responses,
    },
  };
}

function executeFileTool(
  toolCall: FileToolCall,
  files: Map<string, string>,
  contract: GenerationContract,
): string {
  let args: unknown;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return canonicalJson({ ok: false, error: "invalid_arguments" });
  }
  if (toolCall.function.name === "list_files") {
    return canonicalJson({ ok: true, files: [...files.keys()].sort() });
  }
  const pathResult = z
    .object({ path: z.string().min(1).max(240) })
    .passthrough()
    .safeParse(args);
  if (!pathResult.success) {
    return canonicalJson({ ok: false, error: "invalid_path" });
  }
  const path = normalizeProjectPath(pathResult.data.path);
  if (!path) return canonicalJson({ ok: false, error: "unsafe_path" });

  if (toolCall.function.name === "read_file") {
    const content = files.get(path);
    return content === undefined
      ? canonicalJson({ ok: false, error: "not_found" })
      : canonicalJson({ ok: true, content });
  }
  const writeResult = z
    .object({
      path: z.string(),
      content: z.string().max(contract.maxFileBytes),
    })
    .strict()
    .safeParse(args);
  if (!writeResult.success) {
    return canonicalJson({ ok: false, error: "invalid_write" });
  }
  const isNew = !files.has(path);
  if (isNew && files.size >= contract.maxFiles) {
    return canonicalJson({ ok: false, error: "file_limit" });
  }
  const nextBytes =
    [...files.entries()]
      .filter(([existingPath]) => existingPath !== path)
      .reduce(
        (sum, [, content]) => sum + new TextEncoder().encode(content).byteLength,
        0,
      ) + new TextEncoder().encode(writeResult.data.content).byteLength;
  if (nextBytes > contract.maxProjectBytes) {
    return canonicalJson({ ok: false, error: "project_size_limit" });
  }
  files.set(path, writeResult.data.content);
  return canonicalJson({ ok: true, path });
}

function normalizeProjectPath(value: string): string | null {
  const path = value.normalize("NFKC").replaceAll("\\", "/");
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return null;
  }
  return parts.join("/");
}

function parseSamplingSettings(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new GenerationProviderError("invalid_sampling_contract");
  }
  return z
    .object({
      reasoning_effort: z.enum(["low", "medium", "high", "max"]),
      max_completion_tokens: z.number().int().positive().max(200_000),
      temperature: z.number().min(0).max(2).optional(),
      top_p: z.number().positive().max(1).optional(),
      stream: z.literal(false),
    })
    .strict()
    .parse(parsed);
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new GenerationProviderError("provider_response_too_large");
  }
  if (!response.body) throw new GenerationProviderError("provider_empty_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new GenerationProviderError("provider_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const fileTools = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a complete UTF-8 text file in the project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a project text file.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List the project files written so far.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
] as const;

export class GenerationProviderError extends Error {
  constructor(readonly code: string) {
    super("The model provider could not complete generation.");
    this.name = "GenerationProviderError";
  }
}

export class GenerationOutputError extends Error {
  constructor(readonly code: string) {
    super("The model did not produce a usable project.");
    this.name = "GenerationOutputError";
  }
}
