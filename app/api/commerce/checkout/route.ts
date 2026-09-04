import { z } from "zod";
import { createCheckout } from "../../../../lib/commerce/checkout-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { assertSignedShopperBoundary } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";
import { errorResponse } from "../../../../lib/server/errors";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), idempotencyKey: z.string().trim().min(8).max(255) }).strict();

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  try { const body = schema.parse(await request.json()); const context = getTrustedRequestContext(request); const limit = await consumeRateLimit("CHECKOUT", context); if (!limit.ok) return rateLimitResponse(limit.retryAfter); return Response.json(await createCheckout(context, body)); }
  catch (error) { return errorResponse(error, "Checkout could not be created.", 400); }
}
