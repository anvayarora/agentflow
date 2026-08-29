import { assertMerchantContext, getTrustedRequestContext } from "../../../../../lib/server/context";
import { getSalespersonStats } from "../../../../../lib/merchant/salespeople";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await getSalespersonStats(assertMerchantContext(getTrustedRequestContext(request)))); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Salesperson insights unavailable." }, { status: 400 }); }
}
