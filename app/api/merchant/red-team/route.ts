import { getTrustedRequestContext } from "../../../../lib/server/context";
import { runMerchantRedTeam } from "../../../../lib/merchant/operations";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json(await runMerchantRedTeam(getTrustedRequestContext(request)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Red-team run unavailable." }, { status: 400 });
  }
}
