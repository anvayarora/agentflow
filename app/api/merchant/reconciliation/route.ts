import { z } from "zod";
import { reconcilePendingPayments } from "../../../../lib/commerce/checkout-service";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";
import { errorResponse } from "../../../../lib/server/errors";

export const runtime = "nodejs";
const schema = z.object({ idempotencyKey: z.string().trim().min(8).max(255) }).strict();

export async function POST(request: Request) {
  try {
    const auth = await merchantContextOrResponse(request, "OPERATOR");
    if ("response" in auth) return auth.response;
    const budget = await consumeRateLimit("PAYMENT_RECONCILIATION", auth.context);
    if (!budget.ok) return rateLimitResponse(budget.retryAfter);
    const body = schema.parse(await request.json());
    return Response.json(await reconcilePendingPayments(auth.context, body.idempotencyKey));
  } catch (error) { return errorResponse(error, "Payment reconciliation failed.", 400); }
}
