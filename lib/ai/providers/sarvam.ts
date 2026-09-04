import { createHash } from "node:crypto";
import { BULBUL_V3_SPEAKERS, paceToValue, type SalespersonLanguage, type SalespersonPace } from "../../voice/salesperson";

export const SARVAM_BASE_URL = "https://api.sarvam.ai";
export const SARVAM_STT_MODEL = "saaras:v3";
export const SARVAM_TTS_MODEL = "bulbul:v3";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 120;
const MAX_TTS_CHARS = 2500;
const ALLOWED_AUDIO_MIME_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"]);

export class SarvamConfigurationError extends Error { constructor(message = "Sarvam is not configured on the server.") { super(message); this.name = "SarvamConfigurationError"; } }
export class SarvamProviderError extends Error { statusCode?: number; constructor(message: string, statusCode?: number) { super(message); this.name = "SarvamProviderError"; this.statusCode = statusCode; } }

export function sarvamConfigured() { return Boolean(typeof process !== "undefined" && process.env.SARVAM_API_KEY); }
function apiKey() { const key = typeof process !== "undefined" ? process.env.SARVAM_API_KEY : undefined; if (!key) throw new SarvamConfigurationError(); return key; }
function endpoint(path: string) { return `${process.env.SARVAM_BASE_URL || SARVAM_BASE_URL}${path}`; }
function timeoutSignal(ms: number) { return AbortSignal.timeout(ms); }

async function parseResponse(response: Response) {
  const body = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = body ? JSON.parse(body) as Record<string, unknown> : {}; } catch { /* handled as provider error below */ }
  if (!response.ok) {
    const error = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : parsed;
    throw new SarvamProviderError(typeof error.message === "string" ? error.message : `Sarvam request failed with HTTP ${response.status}.`, response.status);
  }
  return parsed;
}

export type SarvamTranscription = { transcript: string; languageCode: string | null; requestId: string | null; latencyMs: number };
export async function transcribeAudio(input: { bytes: Uint8Array; filename?: string; mimeType?: string; languageCode?: string; mode?: "transcribe" | "translate" | "verbatim" | "translit" | "codemix"; durationSeconds?: number }): Promise<SarvamTranscription> {
  if (input.bytes.byteLength === 0) throw new SarvamProviderError("Audio payload is empty.");
  if (input.bytes.byteLength > MAX_AUDIO_BYTES) throw new SarvamProviderError("Audio payload exceeds the 8 MB safety limit.");
  const mimeType = (input.mimeType || "").toLowerCase().split(";", 1)[0];
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) throw new SarvamProviderError("Audio format is not supported.", 415);
  if (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > MAX_AUDIO_DURATION_SECONDS)) throw new SarvamProviderError("Audio duration exceeds the 120 second safety limit.", 413);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: mimeType }), input.filename || "voice-turn.wav");
  form.append("model", process.env.SARVAM_STT_MODEL || SARVAM_STT_MODEL);
  form.append("mode", input.mode || "transcribe");
  form.append("language_code", input.languageCode || "unknown");
  const started = Date.now();
  const response = await fetch(endpoint("/speech-to-text"), { method: "POST", headers: { "api-subscription-key": apiKey() }, body: form, signal: timeoutSignal(Number(process.env.SARVAM_TIMEOUT_MS || 30_000)) });
  const body = await parseResponse(response);
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  return { transcript, languageCode: typeof body.language_code === "string" ? body.language_code : null, requestId: typeof body.request_id === "string" ? body.request_id : null, latencyMs: Date.now() - started };
}

const previewCache = new Map<string, { audioBase64: string; requestId: string | null; createdAt: number }>();
export type SarvamSpeech = { audioBase64: string; mimeType: "audio/wav"; requestId: string | null; latencyMs: number; cached: boolean; characters: number };
export async function synthesizeSpeech(input: { text: string; language: SalespersonLanguage; speakerId: string; pace: SalespersonPace }): Promise<SarvamSpeech> {
  const text = input.text.trim().slice(0, MAX_TTS_CHARS);
  if (!text) throw new SarvamProviderError("Speech text is empty.");
  if (!BULBUL_V3_SPEAKERS.includes(input.speakerId as (typeof BULBUL_V3_SPEAKERS)[number])) throw new SarvamProviderError("Speaker is not supported by Bulbul v3.", 422);
  const languageCode = input.language === "en-IN" ? "en-IN" : "hi-IN";
  const cacheKey = createHash("sha256").update(JSON.stringify([text, languageCode, input.speakerId, input.pace, process.env.SARVAM_TTS_MODEL || SARVAM_TTS_MODEL])).digest("hex");
  const cached = previewCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 86_400_000) return { audioBase64: cached.audioBase64, mimeType: "audio/wav", requestId: cached.requestId, latencyMs: 0, cached: true, characters: text.length };
  const started = Date.now();
  const response = await fetch(endpoint("/text-to-speech"), { method: "POST", headers: { "api-subscription-key": apiKey(), "content-type": "application/json" }, body: JSON.stringify({ text, model: process.env.SARVAM_TTS_MODEL || SARVAM_TTS_MODEL, speaker: input.speakerId, language_code: languageCode, pace: paceToValue[input.pace], speech_sample_rate: 24000, output_audio_codec: "wav", temperature: 0.4 }), signal: timeoutSignal(Number(process.env.SARVAM_TIMEOUT_MS || 30_000)) });
  const body = await parseResponse(response);
  const audioBase64 = Array.isArray(body.audios) && typeof body.audios[0] === "string" ? body.audios[0] : "";
  if (!audioBase64) throw new SarvamProviderError("Sarvam returned no audio payload.");
  const requestId = typeof body.request_id === "string" ? body.request_id : null;
  previewCache.set(cacheKey, { audioBase64, requestId, createdAt: Date.now() });
  while (previewCache.size > 64) previewCache.delete(previewCache.keys().next().value as string);
  return { audioBase64, mimeType: "audio/wav", requestId, latencyMs: Date.now() - started, cached: false, characters: text.length };
}

export function resetSarvamCacheForTests() { previewCache.clear(); }
