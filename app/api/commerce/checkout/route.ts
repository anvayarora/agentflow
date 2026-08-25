import { z } from "zod";
import { createCheckout } from "../../../../lib/commerce/checkout-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255), idempotencyKey: z.string().trim().min(8).max(255) }).strict();

export async function POST(request: Request) {
  try { const body = schema.parse(await request.json()); return Response.json(await createCheckout(getTrustedRequestContext(request), body)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be created." }, { status: 400 }); }
}
