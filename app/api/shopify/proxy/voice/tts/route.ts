import { z } from "zod";
import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";
import { getSalespersonRepository } from "../../../../../../lib/server/repositories/salesperson";
import { SarvamConfigurationError, SarvamProviderError, synthesizeSpeech } from "../../../../../../lib/ai/providers/sarvam";
import { normalizeLanguage } from "../../../../../../lib/voice/salesperson";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { shopifyPublicError } from "../../../../../../lib/server/shopify/public-error";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";
import { consumeRateLimit, rateLimitResponse } from "../../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  text: z.string().trim().min(1).max(4000),
  salespersonProfileId: z.string().trim().min(1).max(255).optional(),
  sessionId: z.string().trim().min(1).max(255).optional(),
  language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, body.sessionId);
    const limit = await consumeRateLimit("VOICE_TTS", `${context.organizationId}:${session.id}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const profileId = body.salespersonProfileId || session.salespersonProfileId;
    if (!profileId) return Response.json({ error: "Choose an AI salesperson first." }, { status: 400 });
    const profile = await getSalespersonRepository().select(context, profileId);
    const speech = await synthesizeSpeech({ text: body.text, language: normalizeLanguage(body.language || session.preferredLanguage), speakerId: profile.speakerId, pace: profile.pacePreset });
    await getCommerceRepository().recordAudit(context, { eventType: "VOICE_TTS_COMPLETED", entityType: "salesperson_profile", entityId: profile.id, shoppingSessionId: session.id, metadata: { source: "shopify_app_proxy", salespersonProfileId: profile.id, language: body.language || session.preferredLanguage || "en-IN", characters: speech.characters, latencyMs: speech.latencyMs, cached: speech.cached, requestId: speech.requestId } });
    return Response.json({ ...speech, sessionId: session.id, salesperson: { id: profile.id, displayName: profile.displayName } });
  } catch (error) {
    if (error instanceof SarvamConfigurationError) return Response.json({ error: "Voice output is not enabled for this store yet.", provider: "SARVAM" }, { status: 503 });
    if (error instanceof SarvamProviderError) return Response.json({ error: "Voice output is temporarily unavailable.", code: "PROVIDER_UNAVAILABLE", provider: "SARVAM" }, { status: error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503 });
    return Response.json(shopifyPublicError(error, "Voice output is temporarily unavailable."), { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
