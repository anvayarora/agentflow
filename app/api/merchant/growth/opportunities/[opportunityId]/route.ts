import { getGrowthRepository } from "../../../../../../lib/server/repositories/growth";
import { merchantContextOrResponse } from "../../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const opportunity = await getGrowthRepository().getOpportunity(auth.context, (await params).opportunityId);
  return opportunity ? Response.json({ opportunity }) : Response.json({ error: "Growth opportunity not found." }, { status: 404 });
}
