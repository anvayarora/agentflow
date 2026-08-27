import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as Parameters<ReturnType<typeof getGrowthRepository>["listOpportunities"]>[1] || undefined;
  return Response.json({ opportunities: await getGrowthRepository().listOpportunities(getTrustedRequestContext(request), status) });
}
