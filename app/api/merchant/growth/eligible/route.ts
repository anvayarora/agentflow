import { z } from "zod";
import { getEligibleGrowthActions } from "../../../../../lib/growth/engine";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().min(1).max(255), cartHash: z.string().nullable().optional() }).strict();
export async function POST(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  try { const input = schema.parse(await request.json()); return Response.json(await getEligibleGrowthActions({ context: auth.context, ...input })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load eligible growth actions." }, { status: 400 }); }
}
