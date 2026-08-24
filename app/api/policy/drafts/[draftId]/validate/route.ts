import { getTrustedRequestContext } from "../../../../../../lib/server/context";
import { getCommerceRepository } from "../../../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const context = getTrustedRequestContext(request);
  const { draftId } = await params;
  const validation = await getCommerceRepository().validateDraft(context, draftId);
  return Response.json(validation, { status: validation.policy ? 200 : 404 });
}
