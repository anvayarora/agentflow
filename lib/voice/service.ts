import type { TrustedRequestContext } from "../server/context";
import { getCommerceRepository } from "../server/repositories/commerce";
import { getSalespersonRepository } from "../server/repositories/salesperson";
import { runStorefrontAgent, type StorefrontAgentResult } from "../ai/storefront/agent";
import { normalizeLanguage, type SalespersonLanguage, type SalespersonProfile } from "./salesperson";
import { synthesizeSpeech, type SarvamSpeech } from "../ai/providers/sarvam";

export type VoiceSessionView = { sessionId: string; salesperson: SalespersonProfile; language: SalespersonLanguage; voiceEnabled: boolean; detectedLanguage: string | null; preferredScript: string | null };

export function detectConversationLanguage(text: string): SalespersonLanguage {
  const hasDevanagari = /[\u0900-\u097F]/u.test(text);
  const latinHindi = /\b(mujhe|chahiye|dikhao|ke|andar|hai|karo|thoda|pehla|doosra|accha|saath|mein|ho|sakta)\b/i.test(text);
  if (hasDevanagari) return "hi-IN";
  if (latinHindi) return "hinglish";
  return "en-IN";
}

export async function ensureVoiceSession(context: TrustedRequestContext, sessionId: string, requestedProfileId?: string, requestedLanguage?: string, voiceEnabled = true): Promise<VoiceSessionView> {
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const profiles = await getSalespersonRepository().ensureDefaults(context);
  const chosen = requestedProfileId ? await getSalespersonRepository().select(context, requestedProfileId) : session.salespersonProfileId ? await getSalespersonRepository().select(context, session.salespersonProfileId) : profiles.find((profile) => profile.isMerchantDefault && profile.isActive) || profiles.find((profile) => profile.isActive);
  if (!chosen) throw new Error("No active AI salesperson is available.");
  const language = normalizeLanguage(requestedLanguage || session.preferredLanguage || "en-IN");
  const changed = Boolean(session.salespersonProfileId && session.salespersonProfileId !== chosen.id);
  const firstSelection = !session.salespersonProfileId;
  const voiceStateChanged = session.voiceEnabled !== voiceEnabled;
  await repository.updateSessionVoice(context, sessionId, { salespersonProfileId: chosen.id, preferredLanguage: language, voiceEnabled, voicePace: chosen.pacePreset });
  if (firstSelection || changed) await repository.recordAudit(context, { eventType: changed ? "SALESPERSON_CHANGED" : "SALESPERSON_SELECTED", entityType: "salesperson_profile", entityId: chosen.id, shoppingSessionId: sessionId, metadata: { salespersonProfileId: chosen.id, displayName: chosen.displayName, speakerId: chosen.speakerId, language, voiceEnabled } });
  if (voiceStateChanged) await repository.recordAudit(context, { eventType: voiceEnabled ? "VOICE_MODE_ENABLED" : "VOICE_MODE_DISABLED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { salespersonProfileId: chosen.id } });
  return { sessionId, salesperson: chosen, language, voiceEnabled, detectedLanguage: session.detectedLanguage || null, preferredScript: session.preferredScript || null };
}

export async function runVoiceTurn(input: { context: TrustedRequestContext; sessionId: string; message: string; salespersonProfileId?: string; language?: string; voiceEnabled?: boolean; storefrontContext?: Record<string, unknown> }): Promise<StorefrontAgentResult & { voice: { enabled: boolean; audioBase64?: string; mimeType?: "audio/wav"; requestId?: string | null; latencyMs?: number; cached?: boolean; provider: "SARVAM" | "TEXT_ONLY"; error?: string }; salesperson: SalespersonProfile; language: SalespersonLanguage; detectedLanguage: SalespersonLanguage }> {
  const language = normalizeLanguage(input.language || detectConversationLanguage(input.message));
  const session = await ensureVoiceSession(input.context, input.sessionId, input.salespersonProfileId, language, input.voiceEnabled !== false);
  const detectedLanguage = detectConversationLanguage(input.message);
  await getCommerceRepository().updateSessionVoice(input.context, input.sessionId, { detectedLanguage, preferredScript: detectedLanguage === "hi-IN" ? "Devanagari" : "Latin", preferredLanguage: language });
  const result = await runStorefrontAgent({ ...input, language, salespersonProfileId: session.salesperson.id });
  const voice = { enabled: session.voiceEnabled, provider: "TEXT_ONLY" as const } as { enabled: boolean; provider: "SARVAM" | "TEXT_ONLY"; audioBase64?: string; mimeType?: "audio/wav"; requestId?: string | null; latencyMs?: number; cached?: boolean; error?: string };
  if (session.voiceEnabled && result.status === "COMPLETED") {
    try {
      const speech: SarvamSpeech = await synthesizeSpeech({ text: result.message, language, speakerId: session.salesperson.speakerId, pace: session.salesperson.pacePreset });
      voice.provider = "SARVAM";
      voice.audioBase64 = speech.audioBase64;
      voice.mimeType = speech.mimeType;
      voice.requestId = speech.requestId;
      voice.latencyMs = speech.latencyMs;
      voice.cached = speech.cached;
      await getCommerceRepository().recordAudit(input.context, { eventType: "VOICE_TTS_COMPLETED", entityType: "salesperson_profile", entityId: session.salesperson.id, shoppingSessionId: input.sessionId, metadata: { salespersonProfileId: session.salesperson.id, speakerId: session.salesperson.speakerId, language, characters: speech.characters, latencyMs: speech.latencyMs, cached: speech.cached, requestId: speech.requestId } });
    } catch (error) {
      voice.error = error instanceof Error ? error.message : "Voice output is unavailable.";
      await getCommerceRepository().recordAudit(input.context, { eventType: "VOICE_PROVIDER_FAILED", entityType: "salesperson_profile", entityId: session.salesperson.id, shoppingSessionId: input.sessionId, metadata: { direction: "tts", language, reason: "provider_unavailable" } });
    }
  }
  return { ...result, salesperson: session.salesperson, language, detectedLanguage, voice };
}
