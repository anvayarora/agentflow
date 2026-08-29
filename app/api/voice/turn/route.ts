import { z } from "zod";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { runVoiceTurn } from "../../../../lib/voice/service";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255).optional(), message: z.string().trim().min(1).max(2000), salespersonProfileId: z.string().trim().min(1).max(255).optional(), language: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(), voiceEnabled: z.boolean().optional(), storefrontContext: z.record(z.string(), z.unknown()).optional() }).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
    const session = body.sessionId ? await getCommerceRepository().getSession(context, body.sessionId) : await getCommerceRepository().createSession(context);
    if (!session) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const result = await runVoiceTurn({ context, sessionId: session.id, message: body.message, salespersonProfileId: body.salespersonProfileId, language: body.language, voiceEnabled: body.voiceEnabled, storefrontContext: body.storefrontContext });
    return Response.json(result, { status: result.status === "PROVIDER_UNAVAILABLE" ? 503 : 200 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Voice turn failed." }, { status: 400 }); }
}
