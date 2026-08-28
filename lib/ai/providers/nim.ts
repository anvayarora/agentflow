import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { request as httpsRequest } from "node:https";

export const NIM_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b";
export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

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

export function getNimModel(): LanguageModel {
  const apiKey = typeof process !== "undefined" ? process.env.NIM_API_KEY : undefined;
  if (!apiKey) throw new NimConfigurationError();
  return createOpenAICompatible({ baseURL: process.env.NIM_BASE_URL || NIM_BASE_URL, name: "nvidia-nim", apiKey, fetch: nimFetch }).chatModel(process.env.NIM_MODEL_ID || NIM_MODEL_ID);
}
