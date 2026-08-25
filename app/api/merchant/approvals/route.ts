import { z } from "zod";
import { decideApproval } from "../../../../lib/commerce/offer-service";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getRuntimeStore, runtimeKinds } from "../../../../lib/server/runtime/store";

export const runtime = "nodejs";
const schema = z.object({ approvalId: z.string().trim().min(1).max(255), decision: z.enum(["APPROVE", "COUNTER", "REJECT"]), counterPricePaise: z.number().int().nonnegative().optional() }).strict();

export async function GET(request: Request) {
  const context = getTrustedRequestContext(request);
  if (context.actorId.startsWith("shopify:")) return Response.json({ error: "Merchant approval access is not available to storefront customers." }, { status: 403 });
  const records = await getRuntimeStore().list(context, runtimeKinds.approval);
  return Response.json({ approvals: records.map((record) => ({ approvalId: record.id, status: record.status, ...record.payload })) });
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const context = getTrustedRequestContext(request);
    if (context.actorId.startsWith("shopify:")) return Response.json({ error: "Only a merchant can decide an approval." }, { status: 403 });
    return Response.json(await decideApproval(context, body.approvalId, body.decision, body.counterPricePaise));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Approval decision failed." }, { status: 400 }); }
}
