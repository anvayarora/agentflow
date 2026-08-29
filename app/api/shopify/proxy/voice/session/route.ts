import { z } from "zod";
import { ensureVoiceSession } from "../../../../../../lib/voice/service";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";

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
    const view = await ensureVoiceSession(context, session.id, body.salespersonProfileId, body.language, body.voiceEnabled !== false);
    return Response.json(view);
  } catch (error) {
    const message = error instanceof ShopifyProxyError ? error.message : error instanceof Error ? error.message : "Voice session could not be prepared.";
    return Response.json({ error: message }, { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
