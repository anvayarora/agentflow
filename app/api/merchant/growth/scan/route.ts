import { scanGrowth } from "../../../../../lib/growth/engine";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const auth = await merchantContextOrResponse(request, "OPERATOR"); if ("response" in auth) return auth.response; const budget = await consumeRateLimit("POLICY_SIMULATION", auth.context); if (!budget.ok) return rateLimitResponse(budget.retryAfter); return Response.json(await scanGrowth(auth.context)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth scan failed." }, { status: 400 }); }
}
