import { z } from "zod";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { getSalespersonRepository } from "../../../../lib/server/repositories/salesperson";
import { SarvamConfigurationError, SarvamProviderError, synthesizeSpeech } from "../../../../lib/ai/providers/sarvam";
import { normalizeLanguage, type SalespersonPace } from "../../../../lib/voice/salesperson";
import { assertSignedShopperBoundary } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ text: z.string().trim().min(1).max(4000), salespersonProfileId: z.string().trim().min(1).max(255), sessionId: z.string().trim().min(1).max(255).optional(), language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(), preview: z.boolean().optional() }).strict();

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
  try {
    const limit = await consumeRateLimit("VOICE_TTS", context);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const body = schema.parse(await request.json());
    const profile = await getSalespersonRepository().select(context, body.salespersonProfileId);
    const repository = getCommerceRepository();
    if (body.sessionId && !(await repository.getSession(context, body.sessionId))) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const speech = await synthesizeSpeech({ text: body.text, language: normalizeLanguage(body.language), speakerId: profile.speakerId, pace: profile.pacePreset as SalespersonPace });
    if (body.sessionId) await repository.recordAudit(context, { eventType: "VOICE_TTS_COMPLETED", entityType: "salesperson_profile", entityId: profile.id, shoppingSessionId: body.sessionId, metadata: { salespersonProfileId: profile.id, speakerId: profile.speakerId, language: body.language || "en-IN", characters: speech.characters, latencyMs: speech.latencyMs, cached: speech.cached, requestId: speech.requestId } });
    if (body.preview) await repository.recordAudit(context, { eventType: "SALESPERSON_PREVIEW_PLAYED", entityType: "salesperson_profile", entityId: profile.id, shoppingSessionId: body.sessionId || null, metadata: { salespersonProfileId: profile.id, speakerId: profile.speakerId, language: body.language || "en-IN", cached: speech.cached, characters: speech.characters } });
    return Response.json({ ...speech, salesperson: { id: profile.id, displayName: profile.displayName, speakerId: profile.speakerId } });
  } catch (error) {
    if (error instanceof SarvamConfigurationError) return Response.json({ error: "Voice output is not enabled for this environment yet.", provider: "SARVAM" }, { status: 503 });
    if (error instanceof SarvamProviderError) return Response.json({ error: error.message, provider: "SARVAM" }, { status: error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503 });
    return Response.json({ error: error instanceof Error ? error.message : "Voice output failed." }, { status: 400 });
  }
}
