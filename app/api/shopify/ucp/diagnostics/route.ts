import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { persistShopifyCapabilitySnapshot, resolveShopifyIntegration } from "../../../../../lib/server/shopify/integration";
import { getShopifyUcpClient, ShopifyUcpError } from "../../../../../lib/server/shopify/ucp";

export const runtime = "nodejs";

export async function GET() {
  const context = getTrustedRequestContext();
  try {
    const client = getShopifyUcpClient();
    const business = await client.discoverBusiness();
    const tools = await client.listTools();
    const snapshot = client.snapshot(tools);
    const integration = await persistShopifyCapabilitySnapshot(context, snapshot);
    return Response.json({ status: "SHOPIFY_UCP_CONNECTED", shopDomain: business.shopDomain, ucpVersion: business.version, mcpEndpoint: business.endpoint, capabilities: business.capabilities, tools: tools.map((tool) => tool.name), appProxy: { storefrontPath: "/apps/agentflow/*", backendPath: "/api/shopify/proxy/*", signatureVerification: "server_verified" }, agentProfileUrl: "configured_server_side", lastVerifiedAt: snapshot.verifiedAt, integrationStatus: integration?.status || "SHOPIFY_UCP_CONNECTED" });
  } catch (error) {
    const status = error instanceof ShopifyUcpError ? error.code : "SHOPIFY_UCP_NOT_VERIFIED";
    const integration = await resolveShopifyIntegration((typeof process === "undefined" ? undefined : process.env.SHOPIFY_STORE_DOMAIN) || "haven-home-k1gerlw9.myshopify.com", context.organizationId).catch(() => null);
    return Response.json({ status: "SHOPIFY_UCP_NOT_VERIFIED", reason: status, shopDomain: integration?.shopDomain || "haven-home-k1gerlw9.myshopify.com", capabilities: {}, tools: [], appProxy: { storefrontPath: "/apps/agentflow/*", backendPath: "/api/shopify/proxy/*", signatureVerification: "server_verified_when_secret_configured" }, agentProfileUrl: "not_verified", lastVerifiedAt: null }, { status: 200 });
  }
}
