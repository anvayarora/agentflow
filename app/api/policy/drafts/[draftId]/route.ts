import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  const { draftId } = await params;
  const draft = await getCommerceRepository().getDraft(context, draftId);
  return draft ? Response.json({ draft }) : Response.json({ error: "Draft not found." }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const context = auth.context;
    const { draftId } = await params;
    const body = await request.json() as { policy?: import("../../../../../lib/policy/schema").PolicyVersionIR };
    if (!body.policy) return Response.json({ error: "A policy IR is required." }, { status: 400 });
    const draft = await getCommerceRepository().updateDraft(context, draftId, body.policy);
    return Response.json({ draft });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update draft." }, { status: 400 });
  }
}
