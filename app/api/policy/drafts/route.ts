import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({})) as { policy?: unknown };
    const context = auth.context;
    const policy = body.policy && typeof body.policy === "object" ? body.policy as import("../../../../lib/policy/schema").PolicyVersionIR : undefined;
    const draft = await getCommerceRepository().createDraft(context, policy);
    return Response.json({ draft }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create policy draft." }, { status: 400 });
  }
}
