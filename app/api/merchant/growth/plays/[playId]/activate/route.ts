import { getTrustedRequestContext } from "../../../../../../../lib/server/context";
import { activateGrowthPlay } from "../../../../../../../lib/growth/plays";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  try { return Response.json({ play: await activateGrowthPlay(getTrustedRequestContext(request), (await params).playId) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth play activation failed." }, { status: 409 }); }
}
