import { z } from "zod";
import { createGrowthPlay } from "../../../../../lib/growth/plays";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { getGrowthRepository } from "../../../../../lib/server/repositories/growth";

export const runtime = "nodejs";
const schema = z.object({ opportunityId: z.string().min(1).max(255), maxIncentiveBps: z.number().int().min(0).max(10_000).optional(), expiresAt: z.string().datetime().nullable().optional() }).strict();
export async function GET(request: Request) { return Response.json({ plays: await getGrowthRepository().listPlays(getTrustedRequestContext(request)) }); }
export async function POST(request: Request) {
  try { const input = schema.parse(await request.json()); return Response.json({ play: await createGrowthPlay(getTrustedRequestContext(request), input.opportunityId, input) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create growth play." }, { status: 400 }); }
}
