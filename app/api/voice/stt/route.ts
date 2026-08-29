import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { SarvamConfigurationError, SarvamProviderError, transcribeAudio } from "../../../../lib/ai/providers/sarvam";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "An audio file is required." }, { status: 400 });
    const sessionId = typeof form.get("sessionId") === "string" ? String(form.get("sessionId")) : undefined;
    const languageCode = typeof form.get("languageCode") === "string" ? String(form.get("languageCode")) : undefined;
    const repository = getCommerceRepository();
    if (sessionId && !(await repository.getSession(context, sessionId))) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const result = await transcribeAudio({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name || "voice-turn.wav", mimeType: file.type || "audio/wav", languageCode });
    if (sessionId) await repository.recordAudit(context, { eventType: "VOICE_STT_COMPLETED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { languageCode: result.languageCode, latencyMs: result.latencyMs, requestId: result.requestId, transcriptLength: result.transcript.length } });
    return Response.json(result);
  } catch (error) {
    if (error instanceof SarvamConfigurationError) return Response.json({ error: "Voice input is not enabled for this environment yet.", provider: "SARVAM" }, { status: 503 });
    if (error instanceof SarvamProviderError) return Response.json({ error: error.message, provider: "SARVAM" }, { status: error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503 });
    return Response.json({ error: error instanceof Error ? error.message : "Voice input failed." }, { status: 400 });
  }
}
