import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";
import { SarvamConfigurationError, SarvamProviderError, transcribeAudio } from "../../../../../../lib/ai/providers/sarvam";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "An audio file is required." }, { status: 400 });
    const sessionId = typeof form.get("sessionId") === "string" ? String(form.get("sessionId")) : undefined;
    const languageCode = typeof form.get("languageCode") === "string" ? String(form.get("languageCode")) : undefined;
    const { context, session } = await getBoundShopifySession(request, sessionId);
    const result = await transcribeAudio({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || "voice-turn.webm",
      mimeType: file.type || "audio/webm",
      languageCode,
    });
    await getCommerceRepository().recordAudit(context, {
      eventType: "VOICE_STT_COMPLETED",
      entityType: "shopping_session",
      entityId: session.id,
      shoppingSessionId: session.id,
      metadata: { source: "shopify_app_proxy", languageCode: result.languageCode, latencyMs: result.latencyMs, requestId: result.requestId, transcriptLength: result.transcript.length },
    });
    return Response.json({ ...result, sessionId: session.id });
  } catch (error) {
    if (error instanceof SarvamConfigurationError) return Response.json({ error: "Voice input is not enabled for this store yet.", provider: "SARVAM" }, { status: 503 });
    if (error instanceof SarvamProviderError) return Response.json({ error: error.message, provider: "SARVAM" }, { status: error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503 });
    const message = error instanceof ShopifyProxyError ? error.message : error instanceof Error ? error.message : "Voice input failed.";
    return Response.json({ error: message }, { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
