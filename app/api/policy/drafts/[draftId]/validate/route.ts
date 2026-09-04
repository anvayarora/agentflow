import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";
import { merchantContextOrResponse } from "../../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  const { draftId } = await params;
  const validation = await getCommerceRepository().validateDraft(context, draftId);
  return Response.json(validation, { status: validation.policy ? 200 : 404 });
}
