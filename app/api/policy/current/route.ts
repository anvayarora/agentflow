import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { policyToLegacyView } from "../../../../lib/policy";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const merchantView = new URL(request.url).searchParams.get("surface") === "merchant";
  if (merchantView) {
    const auth = await merchantContextOrResponse(request, "VIEWER");
    if ("response" in auth) return auth.response;
    const policy = await getCommerceRepository().getCurrentPolicy(auth.context);
    if (!policy) return Response.json({ error: "No published policy is available." }, { status: 404 });
    return Response.json({ policy, policyView: policyToLegacyView(policy) });
  }
  const context = getTrustedRequestContext(request);
  const policy = await getCommerceRepository().getCurrentPolicy(context);
  if (!policy) return Response.json({ error: "No published policy is available." }, { status: 404 });
  return Response.json({ policy: merchantView ? policy : { id: policy.id, version: policy.version, status: policy.status, currency: policy.currency }, policyView: policyToLegacyView(policy) });
}
