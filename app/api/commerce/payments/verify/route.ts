import { z } from "zod";
import { verifyPayment } from "../../../../../lib/commerce/checkout-service";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { assertSignedShopperBoundary } from "../../../../../lib/server/route-guards";
import { errorResponse } from "../../../../../lib/server/errors";

export const runtime = "nodejs";
const schema = z.object({ transactionId: z.string().trim().min(1).max(255), orderId: z.string().trim().min(1).max(255).optional(), paymentId: z.string().trim().min(1).max(255), signature: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  try { const body = schema.parse(await request.json()); return Response.json(await verifyPayment(getTrustedRequestContext(request), body)); }
  catch (error) { return errorResponse(error, "Payment verification failed.", 400, "PAYMENT_VERIFICATION_FAILED"); }
}
