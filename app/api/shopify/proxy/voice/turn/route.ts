import { z } from "zod";
import { runVoiceTurn } from "../../../../../../lib/voice/service";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";
import { consumeRateLimit, rateLimitResponse } from "../../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  sessionId: z.string().trim().min(1).max(255).optional(),
  message: z.string().trim().min(1).max(2000),
  salespersonProfileId: z.string().trim().min(1).max(255).optional(),
  language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(),
  voiceEnabled: z.boolean().optional(),
  inputMode: z.enum(["text", "voice"]).optional(),
  storefrontContext: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, body.sessionId);
    const limit = await consumeRateLimit("STORE_CHAT", `${context.organizationId}:${session.id}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const result = await runVoiceTurn({ context, sessionId: session.id, message: body.message, salespersonProfileId: body.salespersonProfileId, language: body.language, voiceEnabled: body.voiceEnabled, inputMode: body.inputMode || "voice", storefrontContext: body.storefrontContext });
    return Response.json(result, { status: result.status === "PROVIDER_UNAVAILABLE" ? 503 : 200 });
  } catch (error) {
    const message = error instanceof ShopifyProxyError ? error.message : error instanceof Error ? error.message : "Voice turn failed.";
    return Response.json({ error: message }, { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
