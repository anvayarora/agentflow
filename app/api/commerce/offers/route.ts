import { z } from "zod";
import { requestOffer } from "../../../../lib/commerce/offer-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), productId: z.string().trim().min(1).max(255), variantId: z.string().trim().min(1).max(255).optional(), quantity: z.number().int().min(1).max(20), requestedUnitPricePaise: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), requestedDiscountBps: z.number().int().min(0).max(10_000).optional() }).strict().refine((value) => value.requestedUnitPricePaise !== undefined || value.requestedDiscountBps !== undefined, "An offer request must include a price or discount.");

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const context = { ...getTrustedRequestContext(request), actorType: "customer" as const, actorId: "demo-customer" };
    return Response.json(await requestOffer(context, input));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Offer request failed." }, { status: 400 }); }
}
