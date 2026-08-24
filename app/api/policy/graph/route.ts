import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { policyToGraph } from "../../../../lib/policy/graph-projection";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = getTrustedRequestContext(request);
  const id = new URL(request.url).searchParams.get("draftId");
  const policy = id ? await getCommerceRepository().getPolicyVersion(context, id) : await getCommerceRepository().getCurrentPolicy(context);
  return policy ? Response.json({ policyVersionId: policy.id, graph: policyToGraph(policy) }) : Response.json({ error: "Policy not found." }, { status: 404 });
}
