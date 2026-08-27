import { getTrustedRequestContext } from "../../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../../lib/server/repositories/growth";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  const opportunity = await getGrowthRepository().getOpportunity(getTrustedRequestContext(request), (await params).opportunityId);
  return opportunity ? Response.json({ opportunity }) : Response.json({ error: "Growth opportunity not found." }, { status: 404 });
}
