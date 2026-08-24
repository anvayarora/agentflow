import { getTrustedRequestContext } from "../../../../../../lib/server/context";
import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const context = getTrustedRequestContext(request);
    const { draftId } = await params;
    const policy = await getCommerceRepository().publishDraft(context, draftId);
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy cannot be published." }, { status: 409 });
  }
}
