import { z } from "zod";
import { getGrowthRepository } from "../../../../../../lib/server/repositories/growth";
import { updateGrowthPlayStatus } from "../../../../../../lib/growth/plays";
import { merchantContextOrResponse } from "../../../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ status: z.enum(["PAUSED", "DISMISSED"]) }).strict();
export async function GET(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const play = await getGrowthRepository().getPlay(auth.context, (await params).playId);
  return play ? Response.json({ play }) : Response.json({ error: "Growth play not found." }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  const auth = await merchantContextOrResponse(request, "ADMIN");
  if ("response" in auth) return auth.response;
  try { const input = schema.parse(await request.json()); return Response.json({ play: await updateGrowthPlayStatus(auth.context, (await params).playId, input.status) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update growth play." }, { status: 400 }); }
}
