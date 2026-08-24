import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { policyToLegacyView } from "../../../../lib/policy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = getTrustedRequestContext(request);
  const policy = await getCommerceRepository().getCurrentPolicy(context);
  if (!policy) return Response.json({ error: "No published policy is available." }, { status: 404 });
  const merchantView = new URL(request.url).searchParams.get("surface") === "merchant";
  return Response.json({ policy: merchantView ? policy : { id: policy.id, version: policy.version, status: policy.status, currency: policy.currency }, policyView: policyToLegacyView(policy) });
}
