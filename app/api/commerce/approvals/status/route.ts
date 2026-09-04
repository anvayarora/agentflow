import { z } from "zod";
import { getApprovalStatus } from "../../../../../lib/commerce/offer-service";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { assertSignedShopperBoundary } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ approvalId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  try { const body = schema.parse(await request.json()); return Response.json(await getApprovalStatus(getTrustedRequestContext(request), body.approvalId)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Approval status unavailable." }, { status: 400 }); }
}
