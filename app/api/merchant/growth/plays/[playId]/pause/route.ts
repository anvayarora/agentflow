import { getTrustedRequestContext } from "../../../../../../../lib/server/context";
import { updateGrowthPlayStatus } from "../../../../../../../lib/growth/plays";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  try { return Response.json({ play: await updateGrowthPlayStatus(getTrustedRequestContext(request), (await params).playId, "PAUSED") }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth play pause failed." }, { status: 400 }); }
}
