import { merchantContextOrResponse } from "../../../../lib/server/route-guards";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { graphToPolicy, policyToGraph } from "../../../../lib/policy/graph-projection";
import { validatePolicy } from "../../../../lib/policy/validator";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  const id = new URL(request.url).searchParams.get("draftId");
  const policy = id ? await getCommerceRepository().getPolicyVersion(context, id) : await getCommerceRepository().getCurrentPolicy(context);
  return policy ? Response.json({ policyVersionId: policy.id, graph: policyToGraph(policy) }) : Response.json({ error: "Policy not found." }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { draftId?: string; graph?: import("../../../../lib/policy/graph-projection").PolicyGraph };
    if (!body.draftId || !body.graph) return Response.json({ error: "draftId and graph are required." }, { status: 400 });
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const context = auth.context;
    const repository = getCommerceRepository();
    const draft = await repository.getDraft(context, body.draftId);
    if (!draft) return Response.json({ error: "Draft policy not found." }, { status: 404 });
    const validation = validatePolicy(graphToPolicy(draft, body.graph));
    if (!validation.policy) return Response.json({ error: "The graph edit is not a valid policy.", details: validation.errors }, { status: 422 });
    if (validation.discrepancies.length) return Response.json({ error: "Resolve policy discrepancies before saving this graph edit.", discrepancies: validation.discrepancies }, { status: 422 });
    const updated = await repository.updateDraft(context, body.draftId, validation.policy);
    return Response.json({ policy: updated, graph: policyToGraph(updated) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to persist graph edit." }, { status: 400 });
  }
}
