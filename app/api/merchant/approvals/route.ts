import { z } from "zod";
import { decideApproval } from "../../../../lib/commerce/offer-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getApprovalQueueDetail, listApprovalQueue } from "../../../../lib/merchant/operations";

export const runtime = "nodejs";
const schema = z.object({ approvalId: z.string().trim().min(1).max(255), decision: z.enum(["APPROVE", "COUNTER", "REJECT"]), counterPricePaise: z.number().int().nonnegative().optional() }).strict();

export async function GET(request: Request) {
  const context = getTrustedRequestContext(request);
  if (context.actorId.startsWith("shopify:")) return Response.json({ error: "Merchant approval access is not available to storefront customers." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("approvalId")) return Response.json({ approval: await getApprovalQueueDetail(context, params.get("approvalId")!) });
    const status = params.get("status");
    const approvals = await listApprovalQueue(context, { status: status && ["PENDING", "APPROVED", "COUNTERED", "REJECTED", "EXPIRED"].includes(status) ? status as never : undefined, query: params.get("q") || undefined });
    return Response.json({ approvals });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Approval queue unavailable." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const context = getTrustedRequestContext(request);
    if (context.actorId.startsWith("shopify:")) return Response.json({ error: "Only a merchant can decide an approval." }, { status: 403 });
    return Response.json(await decideApproval(context, body.approvalId, body.decision, body.counterPricePaise));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Approval decision failed." }, { status: 400 }); }
}
