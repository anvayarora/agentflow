import { z } from "zod";
import { requestOffer } from "../../../../../lib/commerce/offer-service";
import { ShopifyProxyError } from "../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../lib/server/shopify/proxy-context";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255).optional(), productId: z.string().trim().min(1).max(255), variantId: z.string().trim().min(1).max(255).optional(), quantity: z.number().int().min(1).max(20), requestedUnitPricePaise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), requestedDiscountBps: z.number().int().min(0).max(10_000).optional() }).strict().refine((value) => value.requestedUnitPricePaise !== undefined || value.requestedDiscountBps !== undefined, "An offer request must include a price or discount.");

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, input.sessionId);
    const limit = await consumeRateLimit("OFFER_REQUEST", `${context.organizationId}:${session.id}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const offer = await requestOffer(context, { ...input, sessionId: session.id });
    return Response.json({ sessionId: session.id, ...offer });
  } catch (error) {
    const status = error instanceof ShopifyProxyError ? 401 : error instanceof z.ZodError ? 400 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Offer request failed." }, { status });
  }
}
