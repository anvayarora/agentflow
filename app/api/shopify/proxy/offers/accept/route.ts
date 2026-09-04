import { z } from "zod";
import { acceptOffer } from "../../../../../../lib/commerce/offer-service";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { getShopifyProxyContext, getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";
import { getRuntimeStore, runtimeKinds } from "../../../../../../lib/server/runtime/store";
import { consumeRateLimit, rateLimitResponse } from "../../../../../../lib/server/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ offerId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  try {
    const { context, verified } = await getShopifyProxyContext(request);
    const limit = await consumeRateLimit("OFFER_REQUEST", `${context.organizationId}:${verified.shopDomain}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const input = schema.parse(await request.json());
    const offer = await getRuntimeStore().get<{ sessionId: string }>(context, runtimeKinds.offer, input.offerId);
    if (!offer) return Response.json({ error: "Offer was not found." }, { status: 404 });
    await getBoundShopifySession(request, offer.payload.sessionId);
    const result = await acceptOffer(context, input.offerId);
    return Response.json({ shopDomain: verified.shopDomain, ...result });
  } catch (error) {
    const status = error instanceof ShopifyProxyError ? 401 : error instanceof z.ZodError ? 400 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Offer acceptance failed." }, { status });
  }
}
