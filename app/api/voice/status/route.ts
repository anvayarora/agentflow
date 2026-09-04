import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getSalespersonRepository } from "../../../../lib/server/repositories/salesperson";
import { sarvamConfigured, SARVAM_STT_MODEL, SARVAM_TTS_MODEL } from "../../../../lib/ai/providers/sarvam";
import { assertSignedShopperBoundary } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  try {
    const context = getTrustedRequestContext(request);
    const profiles = await getSalespersonRepository().ensureDefaults(context);
    return Response.json({ provider: "SARVAM", configured: sarvamConfigured(), sttModel: process.env.SARVAM_STT_MODEL || SARVAM_STT_MODEL, ttsModel: process.env.SARVAM_TTS_MODEL || SARVAM_TTS_MODEL, activeProfiles: profiles.filter((profile) => profile.isActive).length });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Voice status unavailable." }, { status: 400 }); }
}
