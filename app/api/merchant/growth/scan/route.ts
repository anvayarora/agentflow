import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { scanGrowth } from "../../../../../lib/growth/engine";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return Response.json(await scanGrowth(getTrustedRequestContext(request))); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Growth scan failed." }, { status: 400 }); }
}
