import { z } from "zod";
import { acceptOffer } from "../../../../../lib/commerce/offer-service";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { assertSignedShopperBoundary } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ offerId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  try { const body = schema.parse(await request.json()); return Response.json(await acceptOffer(getTrustedRequestContext(request), body.offerId)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Offer could not be accepted." }, { status: 400 }); }
}
