import { z } from "zod";
import { getCart, updateCart } from "../../../../lib/commerce/catalog-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), lines: z.array(z.object({ variantId: z.string().trim().min(1).max(255), quantity: z.number().int().min(1).max(20) }).strict()).max(20) }).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
    const session = await getCommerceRepository().getSession(context, input.sessionId);
    if (!session) return Response.json({ error: "Shopping session not found." }, { status: 404 });
    return Response.json(await updateCart(context, session, input.lines));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Cart update failed." }, { status: 400 }); }
}

export async function GET(request: Request) {
  try {
    const sessionId = z.string().trim().min(1).max(255).parse(new URL(request.url).searchParams.get("sessionId"));
    const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
    const session = await getCommerceRepository().getSession(context, sessionId);
    if (!session) return Response.json({ error: "Shopping session not found." }, { status: 404 });
    return Response.json(await getCart(context, session));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Cart read failed." }, { status: 400 }); }
}
