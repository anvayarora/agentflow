import { simulateGrowthPlay } from "../../../../../../../lib/growth/plays";
import { merchantContextOrResponse } from "../../../../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  try { const auth = await merchantContextOrResponse(request, "OPERATOR"); if ("response" in auth) return auth.response; return Response.json(await simulateGrowthPlay(auth.context, (await params).playId)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth play simulation failed." }, { status: 400 }); }
}
