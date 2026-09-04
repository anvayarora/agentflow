import { updateGrowthPlayStatus } from "../../../../../../../lib/growth/plays";
import { merchantContextOrResponse } from "../../../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  try { const auth = await merchantContextOrResponse(request, "ADMIN"); if ("response" in auth) return auth.response; return Response.json({ play: await updateGrowthPlayStatus(auth.context, (await params).playId, "PAUSED") }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth play pause failed." }, { status: 400 }); }
}
