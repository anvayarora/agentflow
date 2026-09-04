import { merchantContextOrResponse } from "../../../lib/server/route-guards";
import { getCommerceRepository } from "../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
  return Response.json({ events: await getCommerceRepository().listAudit(context, Number.isFinite(limit) ? limit : 100) });
}
