import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER"); if ("response" in auth) return auth.response;
  return Response.json({ signals: await getGrowthRepository().listSignals(auth.context) });
}
