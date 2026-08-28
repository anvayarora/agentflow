import { getTrustedRequestContext } from "../../../../lib/server/context";
import { queryAuditTrail, type AuditFilters } from "../../../../lib/merchant/operations";

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
    return Response.json({ events: await queryAuditTrail(getTrustedRequestContext(request), filters) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Audit trail unavailable." }, { status: 400 });
  }
}
