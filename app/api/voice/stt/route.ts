import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { SarvamConfigurationError, SarvamProviderError, transcribeAudio } from "../../../../lib/ai/providers/sarvam";
import { assertSignedShopperBoundary } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";
import { errorResponse, normalizedError } from "../../../../lib/server/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
  try {
    const limit = await consumeRateLimit("VOICE_STT", context);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "An audio file is required." }, { status: 400 });
    const sessionId = typeof form.get("sessionId") === "string" ? String(form.get("sessionId")) : undefined;
    const languageCode = typeof form.get("languageCode") === "string" ? String(form.get("languageCode")) : undefined;
    const durationValue = typeof form.get("durationSeconds") === "string" ? Number(form.get("durationSeconds")) : undefined;
    const repository = getCommerceRepository();
    if (sessionId && !(await repository.getSession(context, sessionId))) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const result = await transcribeAudio({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name || "voice-turn.wav", mimeType: file.type || "audio/wav", languageCode, durationSeconds: Number.isFinite(durationValue) ? durationValue : undefined });
    if (sessionId) await repository.recordAudit(context, { eventType: "VOICE_STT_COMPLETED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { languageCode: result.languageCode, latencyMs: result.latencyMs, requestId: result.requestId, transcriptLength: result.transcript.length } });
    return Response.json(result);
  } catch (error) {
    if (error instanceof SarvamConfigurationError) return Response.json({ ...normalizedError(error, "Voice input is not enabled for this environment yet.", "PROVIDER_UNAVAILABLE"), provider: "SARVAM" }, { status: 503 });
    if (error instanceof SarvamProviderError) {
      const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503;
      return Response.json({ ...normalizedError(error, "Voice input is temporarily unavailable.", status === 503 ? "PROVIDER_UNAVAILABLE" : "REQUEST_FAILED"), provider: "SARVAM" }, { status });
    }
    return errorResponse(error, "Voice input failed.", 400);
  }
}
