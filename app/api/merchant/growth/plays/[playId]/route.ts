import { z } from "zod";
import { getTrustedRequestContext } from "../../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../../lib/server/repositories/growth";
import { updateGrowthPlayStatus } from "../../../../../../lib/growth/plays";

export const runtime = "nodejs";
const schema = z.object({ status: z.enum(["PAUSED", "DISMISSED"]) }).strict();
export async function GET(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  const play = await getGrowthRepository().getPlay(getTrustedRequestContext(request), (await params).playId);
  return play ? Response.json({ play }) : Response.json({ error: "Growth play not found." }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ playId: string }> }) {
  try { const input = schema.parse(await request.json()); return Response.json({ play: await updateGrowthPlayStatus(getTrustedRequestContext(request), (await params).playId, input.status) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update growth play." }, { status: 400 }); }
}
