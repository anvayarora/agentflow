import { z } from "zod";
import { getPaymentStatus } from "../../../../../../lib/commerce/checkout-service";
import { ShopifyProxyError } from "../../../../../../lib/server/shopify/proxy";
import { getBoundShopifySession } from "../../../../../../lib/server/shopify/proxy-context";
import { shopifyPublicError } from "../../../../../../lib/server/shopify/public-error";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), transactionId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, input.sessionId);
    void session;
    return Response.json(await getPaymentStatus(context, input.transactionId));
  } catch (error) {
    const status = error instanceof ShopifyProxyError ? 401 : error instanceof z.ZodError ? 400 : 400;
    return Response.json(shopifyPublicError(error, "Payment status is temporarily unavailable."), { status });
  }
}
