import { getGrowthResults } from "../../../../../lib/merchant/operations";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await merchantContextOrResponse(request, "VIEWER"); if ("response" in auth) return auth.response;
    return Response.json(await getGrowthResults(auth.context));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Growth results unavailable." }, { status: 400 });
  }
}
