import { z } from "zod";
import { getEligibleGrowthActions } from "../../../../../lib/growth/engine";
import { getTrustedRequestContext } from "../../../../../lib/server/context";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().min(1).max(255), cartHash: z.string().nullable().optional() }).strict();
export async function POST(request: Request) {
  try { const input = schema.parse(await request.json()); return Response.json(await getEligibleGrowthActions({ context: getTrustedRequestContext(request), ...input })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load eligible growth actions." }, { status: 400 }); }
}
