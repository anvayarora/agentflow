import { runMerchantRedTeam } from "../../../../lib/merchant/operations";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const budget = await consumeRateLimit("RED_TEAM", auth.context);
    if (!budget.ok) return rateLimitResponse(budget.retryAfter);
    return Response.json(await runMerchantRedTeam(auth.context));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Red-team run unavailable." }, { status: 400 });
  }
}
