import { listProductMappings } from "../../../../../lib/server/repositories/bootstrap";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  try { return Response.json({ mappings: await listProductMappings(auth.context) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Catalogue mappings are unavailable." }, { status: 400 }); }
}
