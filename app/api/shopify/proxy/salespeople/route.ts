import { getSalespersonRepository } from "../../../../../lib/server/repositories/salesperson";
import { ShopifyProxyError } from "../../../../../lib/server/shopify/proxy";
import { getShopifyProxyContext } from "../../../../../lib/server/shopify/proxy-context";
import { shopifyPublicError } from "../../../../../lib/server/shopify/public-error";

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
    return Response.json(shopifyPublicError(error, "Salesperson profiles are temporarily unavailable."), { status: error instanceof ShopifyProxyError ? 401 : 400 });
  }
}
