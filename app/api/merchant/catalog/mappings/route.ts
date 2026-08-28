import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { listProductMappings } from "../../../../../lib/server/repositories/bootstrap";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return Response.json({ mappings: await listProductMappings(getTrustedRequestContext(request)) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Catalogue mappings are unavailable." }, { status: 400 }); }
}
