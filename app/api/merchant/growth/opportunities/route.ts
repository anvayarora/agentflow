import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as Parameters<ReturnType<typeof getGrowthRepository>["listOpportunities"]>[1] || undefined;
  const auth = await merchantContextOrResponse(request, "VIEWER"); if ("response" in auth) return auth.response;
  return Response.json({ opportunities: await getGrowthRepository().listOpportunities(auth.context, status) });
}
