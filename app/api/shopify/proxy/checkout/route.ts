import { z } from "zod";
import { createCheckout } from "../../../../../lib/commerce/checkout-service";
import { ShopifyProxyError } from "../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../lib/server/shopify/proxy-context";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), idempotencyKey: z.string().trim().min(8).max(255) }).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, input.sessionId);
    return Response.json(await createCheckout(context, { sessionId: session.id, idempotencyKey: input.idempotencyKey }));
  } catch (error) {
    const status = error instanceof ShopifyProxyError ? 401 : error instanceof z.ZodError ? 400 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be created." }, { status });
  }
}
