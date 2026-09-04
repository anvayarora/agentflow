import { z } from "zod";
import { createGrowthPlay } from "../../../../../lib/growth/plays";
import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ opportunityId: z.string().min(1).max(255), maxIncentiveBps: z.number().int().min(0).max(10_000).optional(), expiresAt: z.string().datetime().nullable().optional() }).strict();
export async function GET(request: Request) { const auth = await merchantContextOrResponse(request, "VIEWER"); if ("response" in auth) return auth.response; return Response.json({ plays: await getGrowthRepository().listPlays(auth.context) }); }
export async function POST(request: Request) {
  try { const auth = await merchantContextOrResponse(request, "OPERATOR"); if ("response" in auth) return auth.response; const input = schema.parse(await request.json()); return Response.json({ play: await createGrowthPlay(auth.context, input.opportunityId, input) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create growth play." }, { status: 400 }); }
}
