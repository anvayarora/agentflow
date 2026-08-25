import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const NIM_MODEL_ID = "meta/llama-3.1-8b-instruct";
export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

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
  return createOpenAICompatible({ baseURL: process.env.NIM_BASE_URL || NIM_BASE_URL, name: "nvidia-nim", apiKey }).chatModel(process.env.NIM_MODEL_ID || NIM_MODEL_ID);
}
