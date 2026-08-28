import { z } from "zod";
import { runStorefrontAgent } from "../../../../lib/ai/storefront/agent";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

const schema = z.object({
  sessionId: z.string().trim().min(1).max(255).optional(),
  message: z.string().trim().min(1).max(2000),
  storefrontContext: z.object({ pageType: z.enum(["home", "collection", "product", "search", "cart", "other"]).optional(), currentProductId: z.string().max(255).optional(), currentCollection: z.string().max(120).optional(), url: z.string().url().max(2048).optional() }).strict().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const base = getTrustedRequestContext(request);
    const context = { ...base, actorType: "customer" as const, actorId: "demo-customer" };
    const repository = getCommerceRepository();
    const session = body.sessionId ? await repository.getSession(context, body.sessionId) : await repository.createSession(context);
    if (!session) return Response.json({ error: "Commerce session was not found." }, { status: 404 });
    const result = await runStorefrontAgent({ context, sessionId: session.id, message: body.message, storefrontContext: body.storefrontContext });
    return Response.json(result, { status: result.status === "PROVIDER_UNAVAILABLE" ? 503 : 200 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Storefront agent request failed." }, { status: 400 }); }
}
