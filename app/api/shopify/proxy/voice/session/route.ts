import { z } from "zod";
import { ensureVoiceSession } from "../../../../../../lib/voice/service";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { shopifyPublicError } from "../../../../../../lib/server/shopify/public-error";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";
import { consumeRateLimit, rateLimitResponse } from "../../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  sessionId: z.string().trim().min(1).max(255).optional(),
  salespersonProfileId: z.string().trim().min(1).max(255).optional(),
  language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(),
  voiceEnabled: z.boolean().optional(),
  selectorOpened: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json().catch(() => ({})));
    const { context, session } = await getBoundShopifySession(request, body.sessionId);
    const limit = await consumeRateLimit("VOICE_SESSION", `${context.organizationId}:${session.id}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const view = await ensureVoiceSession(context, session.id, body.salespersonProfileId, body.language, body.voiceEnabled !== false);
    return Response.json(view);
  } catch (error) {
    return Response.json(shopifyPublicError(error, "Voice session could not be prepared."), { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
