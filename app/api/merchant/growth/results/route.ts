import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { getGrowthResults } from "../../../../../lib/merchant/operations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json(await getGrowthResults(getTrustedRequestContext(request)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Growth results unavailable." }, { status: 400 });
  }
}
