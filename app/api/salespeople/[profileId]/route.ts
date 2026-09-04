import { assertMerchantContext } from "../../../../lib/server/context";
import { merchantContextOrResponse } from "../../../../lib/server/route-guards";
import { getSalespersonRepository } from "../../../../lib/server/repositories/salesperson";
import { salespersonUpdateSchema } from "../../../../lib/voice/salesperson";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { profileId: string } }) {
  try {
    const auth = await merchantContextOrResponse(request, "ADMIN");
    if ("response" in auth) return auth.response;
    const context = assertMerchantContext(auth.context);
    const profile = await getSalespersonRepository().update(context, params.profileId, salespersonUpdateSchema.parse(await request.json()));
    return Response.json({ profile });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Salesperson could not be updated." }, { status: 400 }); }
}
