import { z } from "zod";
import { verifyPayment } from "../../../../../lib/commerce/checkout-service";
import { getTrustedRequestContext } from "../../../../../lib/server/context";

export const runtime = "nodejs";
const schema = z.object({ transactionId: z.string().trim().min(1).max(255), paymentId: z.string().trim().min(1).max(255), signature: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  try { const body = schema.parse(await request.json()); return Response.json(await verifyPayment(getTrustedRequestContext(request), body)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Payment verification failed." }, { status: 400 }); }
}
