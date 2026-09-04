import { persistShopifyCapabilitySnapshot, resolveShopifyIntegration } from "../../../../../lib/server/shopify/integration";
import { configuredShopDomain, getShopifyUcpClient, ShopifyUcpError } from "../../../../../lib/server/shopify/ucp";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const context = auth.context;
  try {
    const client = getShopifyUcpClient();
    const business = await client.discoverBusiness();
    const tools = await client.listTools();
    const snapshot = client.snapshot(tools);
    const integration = await persistShopifyCapabilitySnapshot(context, snapshot);
    return Response.json({ status: "SHOPIFY_UCP_CONNECTED", shopDomain: business.shopDomain, ucpVersion: business.version, mcpEndpoint: business.endpoint, capabilities: business.capabilities, tools: tools.map((tool) => tool.name), appProxy: { storefrontPath: "/apps/agentflow/*", backendPath: "/api/shopify/proxy/*", signatureVerification: "server_verified" }, agentProfileUrl: "configured_server_side", lastVerifiedAt: snapshot.verifiedAt, integrationStatus: integration?.status || "SHOPIFY_UCP_CONNECTED" });
  } catch (error) {
    const status = error instanceof ShopifyUcpError ? error.code : "SHOPIFY_UCP_NOT_VERIFIED";
    const shopDomain = (() => { try { return configuredShopDomain(); } catch { return null; } })();
    const integration = shopDomain ? await resolveShopifyIntegration(shopDomain, context.organizationId).catch(() => null) : null;
    return Response.json({ status: "SHOPIFY_UCP_NOT_VERIFIED", reason: status, shopDomain: integration?.shopDomain || shopDomain, capabilities: {}, tools: [], appProxy: { storefrontPath: "/apps/agentflow/*", backendPath: "/api/shopify/proxy/*", signatureVerification: "server_verified_when_secret_configured" }, agentProfileUrl: "not_verified", lastVerifiedAt: null }, { status: 200 });
  }
}
