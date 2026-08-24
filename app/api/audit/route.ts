import { getTrustedRequestContext } from "../../../lib/server/context";
import { getCommerceRepository } from "../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = getTrustedRequestContext(request);
  const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
  return Response.json({ events: await getCommerceRepository().listAudit(context, Number.isFinite(limit) ? limit : 100) });
}
