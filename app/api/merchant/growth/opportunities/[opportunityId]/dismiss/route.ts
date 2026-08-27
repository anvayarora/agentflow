import { getTrustedRequestContext } from "../../../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../../../lib/server/repositories/growth";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const opportunity = await getGrowthRepository().updateOpportunityStatus(getTrustedRequestContext(request), (await params).opportunityId, "DISMISSED");
  return opportunity ? Response.json({ opportunity }) : Response.json({ error: "Growth opportunity not found." }, { status: 404 });
}
