import { queryAuditTrail, type AuditFilters } from "../../../../lib/merchant/operations";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters: AuditFilters = {
      correlationId: params.get("correlationId") || undefined,
      transactionId: params.get("transactionId") || undefined,
      sessionId: params.get("sessionId") || undefined,
      offerId: params.get("offerId") || undefined,
      approvalId: params.get("approvalId") || undefined,
      growthPlayId: params.get("growthPlayId") || undefined,
      shopDomain: params.get("shopDomain") || undefined,
      eventType: params.get("eventType") || undefined,
      actorId: params.get("actorId") || undefined,
      limit: Number(params.get("limit") || 200),
    };
    const auth = await merchantContextOrResponse(request, "VIEWER");
    if ("response" in auth) return auth.response;
    return Response.json({ events: await queryAuditTrail(auth.context, filters) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Audit trail unavailable." }, { status: 400 });
  }
}
