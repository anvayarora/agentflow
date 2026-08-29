import { getSalespersonRepository } from "../../../../../lib/server/repositories/salesperson";
import { ShopifyProxyError } from "../../../../../lib/server/shopify/proxy";
import { getShopifyProxyContext } from "../../../../../lib/server/shopify/proxy-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { context } = await getShopifyProxyContext(request);
    const profiles = await getSalespersonRepository().ensureDefaults(context);
    return Response.json({
      salespeople: profiles.filter((profile) => profile.isActive).map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        description: profile.description,
        languageSupport: profile.languageSupport,
        tonePreset: profile.tonePreset,
        pacePreset: profile.pacePreset,
        avatarKey: profile.avatarKey ?? null,
        isMerchantDefault: profile.isMerchantDefault,
      })),
    });
  } catch (error) {
    const message = error instanceof ShopifyProxyError ? error.message : error instanceof Error ? error.message : "Salesperson profiles are unavailable.";
    return Response.json({ error: message }, { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
