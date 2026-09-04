import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";
import { merchantContextOrResponse } from "../../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const context = auth.context;
    const { draftId } = await params;
    const policy = await getCommerceRepository().publishDraft(context, draftId);
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy cannot be published." }, { status: 409 });
  }
}
