import { z } from "zod";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { ensureVoiceSession } from "../../../../lib/voice/service";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255).optional(), salespersonProfileId: z.string().trim().min(1).max(255).optional(), language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(), voiceEnabled: z.boolean().optional(), selectorOpened: z.boolean().optional() }).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json().catch(() => ({})));
    const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
    const session = body.sessionId ? await getCommerceRepository().getSession(context, body.sessionId) : await getCommerceRepository().createSession(context);
    if (!session) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const view = await ensureVoiceSession(context, session.id, body.salespersonProfileId, body.language, body.voiceEnabled !== false);
    if (body.selectorOpened) await getCommerceRepository().recordAudit(context, { eventType: "SALESPERSON_SELECTOR_OPENED", entityType: "shopping_session", entityId: session.id, shoppingSessionId: session.id, metadata: { salespersonProfileId: view.salesperson.id, language: view.language } });
    return Response.json(view);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Voice session could not be prepared." }, { status: 400 }); }
}
