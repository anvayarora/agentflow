import { assertMerchantContext, getTrustedRequestContext } from "../../../lib/server/context";
import { getSalespersonRepository } from "../../../lib/server/repositories/salesperson";
import { salespersonCreateSchema } from "../../../lib/voice/salesperson";
import { getCommerceRepository } from "../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = getTrustedRequestContext(request);
    const profiles = await getSalespersonRepository().ensureDefaults(context);
    return Response.json({ profiles: profiles.filter((profile) => profile.isActive) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Salespeople are unavailable." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const context = assertMerchantContext(getTrustedRequestContext(request));
    const profile = await getSalespersonRepository().create(context, salespersonCreateSchema.parse(await request.json()));
    await getCommerceRepository().recordAudit(context, { eventType: "SALESPERSON_SELECTED", entityType: "salesperson_profile", entityId: profile.id, metadata: { action: "created", displayName: profile.displayName, speakerId: profile.speakerId } });
    return Response.json({ profile }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Salesperson could not be created." }, { status: 400 }); }
}
