import { z } from "zod";
import { decideApproval } from "../../../../lib/commerce/offer-service";
import { getApprovalQueueDetail, listApprovalQueue } from "../../../../lib/merchant/operations";
import { merchantContextOrResponse, authErrorResponse } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";
const schema = z.object({ approvalId: z.string().trim().min(1).max(255), decision: z.enum(["APPROVE", "COUNTER", "REJECT"]), counterPricePaise: z.number().int().nonnegative().optional() }).strict();

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "OPERATOR");
  if ("response" in auth) return auth.response;
  const context = auth.context;
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
    const auth = await merchantContextOrResponse(request, "OPERATOR");
    if ("response" in auth) return auth.response;
    return Response.json(await decideApproval(auth.context, body.approvalId, body.decision, body.counterPricePaise));
  } catch (error) { return authErrorResponse(error, "Approval decision failed."); }
}
