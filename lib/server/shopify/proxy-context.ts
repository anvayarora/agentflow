import { getTrustedRequestContext, type TrustedRequestContext } from "../context";
import { getCommerceRepository } from "../repositories/commerce";
import { resolveShopifyIntegration } from "./integration";
import { ShopifyProxyError, verifyShopifyProxyRequest, type VerifiedShopifyProxyRequest } from "./proxy";

export async function getShopifyProxyContext(request: Request) {
  let verified: VerifiedShopifyProxyRequest;
  try {
    verified = verifyShopifyProxyRequest(request);
  } catch (error) {
    if (error instanceof ShopifyProxyError) throw error;
    throw new ShopifyProxyError("Shopify App Proxy request could not be verified.");
  }
  const base = getTrustedRequestContext(request);
  const integration = await resolveShopifyIntegration(verified.shopDomain, base.organizationId);
  if (!integration) throw new ShopifyProxyError("This Shopify store is not linked to an AgentFlow organization.", "PROXY_TENANT_NOT_LINKED");
  const context: TrustedRequestContext = {
    organizationId: integration.organizationId,
    actorType: "customer",
    actorId: verified.loggedInCustomerId ? `shopify:${verified.loggedInCustomerId}` : "shopify:anonymous",
    correlationId: base.correlationId,
  };
  return { verified, integration, context };
}

export async function getBoundShopifySession(request: Request, sessionId?: string) {
  const { verified, context } = await getShopifyProxyContext(request);
  const repository = getCommerceRepository();
  const session = sessionId
    ? await repository.getSession(context, sessionId)
    : await repository.createShopifySession(context, { shopDomain: verified.shopDomain, shopifyCustomerId: verified.loggedInCustomerId });
  if (!session) throw new ShopifyProxyError("Shopify AgentFlow session was not found.", "SHOPIFY_SESSION_NOT_FOUND");
  if (session.shopifyShopDomain !== verified.shopDomain) throw new ShopifyProxyError("Shopify session shop binding is invalid.", "SHOPIFY_SESSION_SHOP_MISMATCH");
  if (verified.loggedInCustomerId && session.shopifyCustomerId && session.shopifyCustomerId !== verified.loggedInCustomerId) throw new ShopifyProxyError("Shopify customer binding is invalid.", "SHOPIFY_SESSION_CUSTOMER_MISMATCH");
  return { verified, context, session };
}
