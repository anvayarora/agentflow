import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { request as httpsRequest } from "node:https";

export const NIM_MODEL_ID = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export type NimHealthStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";

export type NimHealth = {
  status: NimHealthStatus;
  model: string;
  latencyMs: number;
  reason?: "NOT_CONFIGURED" | "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_RESPONSE";
};

/**
 * NVIDIA's hosted endpoint can leave a non-streaming response socket open in
 * some serverless egress paths. Keep the provider server-authoritative while
 * using Node's native HTTPS client so response completion is deterministic.
 */
export const nimFetch: typeof fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : undefined;
  const target = new URL(request?.url || (input instanceof URL ? input.toString() : String(input)));
  const method = init.method || request?.method || "GET";
  const headers = new Headers(request?.headers || undefined);
  new Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
  headers.set("connection", "close");
  const rawBody = init.body ?? request?.body;
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody instanceof Uint8Array ? Buffer.from(rawBody) : undefined;
  if (body && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const finishResolve = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const abort = () => {
      const error = new DOMException("The operation was aborted.", "AbortError");
      client.destroy(error);
      finishReject(error);
    };
    const client = httpsRequest({ hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method, headers: Object.fromEntries(headers.entries()) }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) responseHeaders.set(key, value.join(", "));
          else if (value !== undefined) responseHeaders.set(key, value);
        }
        finishResolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 500, statusText: response.statusMessage, headers: responseHeaders }));
      });
      response.on("error", finishReject);
    });
    client.once("error", finishReject);
    client.setTimeout(120_000, () => finishReject(new Error("NIM request timed out.")));
    if (init.signal) {
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    }
    if (body) client.write(body);
    client.end();
  });
};

export class NimConfigurationError extends Error {
  constructor(message = "NVIDIA NIM is not configured on the server.") {
    super(message);
    this.name = "NimConfigurationError";
  }
}

export function nimConfigured() {
  return Boolean(typeof process !== "undefined" && process.env.NIM_API_KEY);
}

/**
 * Run one minimal server-side provider check. The response body is inspected
 * only for the expected marker and is never returned or logged. Callers should
 * invoke this explicitly (for example, from an operator health check) rather
 * than polling it as part of every shopper request.
 */
export async function probeNimHealth(options: { timeoutMs?: number } = {}): Promise<NimHealth> {
  const model = typeof process !== "undefined" ? process.env.NIM_MODEL_ID || NIM_MODEL_ID : NIM_MODEL_ID;
  const apiKey = typeof process !== "undefined" ? process.env.NIM_API_KEY : undefined;
  if (!apiKey) return { status: "UNAVAILABLE", model, latencyMs: 0, reason: "NOT_CONFIGURED" };
  const baseUrl = typeof process !== "undefined" ? process.env.NIM_BASE_URL || NIM_BASE_URL : NIM_BASE_URL;
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs || 8_000, 15_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await nimFetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "You are an AgentFlow provider health check." }, { role: "user", content: "Reply with exactly AGENTFLOW_NIM_OK." }], temperature: 0, max_tokens: 16, stream: false }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (response.status === 401 || response.status === 403) return { status: "UNAVAILABLE", model, latencyMs, reason: "AUTHENTICATION_FAILED" };
    if (response.status === 429) return { status: "DEGRADED", model, latencyMs, reason: "RATE_LIMITED" };
    if (response.status >= 500) return { status: "DEGRADED", model, latencyMs, reason: "PROVIDER_ERROR" };
    if (!response.ok) return { status: "DEGRADED", model, latencyMs, reason: "PROVIDER_ERROR" };
    try {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() === "AGENTFLOW_NIM_OK"
        ? { status: "AVAILABLE", model, latencyMs }
        : { status: "DEGRADED", model, latencyMs, reason: "INVALID_RESPONSE" };
    } catch {
      return { status: "DEGRADED", model, latencyMs, reason: "INVALID_RESPONSE" };
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return { status: "DEGRADED", model, latencyMs, reason: message.includes("abort") || message.includes("timeout") ? "TIMEOUT" : "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timeout);
  }
}

export function getNimModel(): LanguageModel {
  const apiKey = typeof process !== "undefined" ? process.env.NIM_API_KEY : undefined;
  if (!apiKey) throw new NimConfigurationError();
  return createOpenAICompatible({ baseURL: process.env.NIM_BASE_URL || NIM_BASE_URL, name: "nvidia-nim", apiKey, fetch: nimFetch }).chatModel(process.env.NIM_MODEL_ID || NIM_MODEL_ID);
}
