import { getSalespersonStats } from "../../../../../lib/merchant/salespeople";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  try { return Response.json(await getSalespersonStats(auth.context)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Salesperson insights unavailable." }, { status: 400 }); }
}
