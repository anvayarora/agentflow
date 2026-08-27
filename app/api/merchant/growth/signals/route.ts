import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return Response.json({ signals: await getGrowthRepository().listSignals(getTrustedRequestContext(request)) });
}
