import { products as demoProducts } from "../../../../../lib/catalogue";
import type { Product } from "../../../../../lib/policy";
import { shopifyPreviewStore } from "../../../../../lib/connectors";
import { getStoredShopifyAdminAccessToken } from "../../../../../lib/server/shopify/integration";
import { normalizeShopDomain } from "../../../../../lib/server/shopify/ucp";
import { merchantContextOrResponse } from "../../../../../lib/server/route-guards";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

const getEnv = (name: string) => (typeof process === "undefined" ? undefined : process.env[name]);

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

type LiveProductNode = { id: string; title: string; handle?: string; description?: string; descriptionHtml?: string; totalInventory?: number; variants?: { nodes?: Array<{ price?: string; sku?: string }> } };

const mapLiveProduct = (node: LiveProductNode, index: number): Product => {
  const variant = node.variants?.nodes?.[0];
  return {
    id: node.id,
    sku: variant?.sku || `SHOPIFY-${index + 1}`,
    name: node.title,
    category: "Connected catalogue",
    price: Number(variant?.price || 0),
    cost: null,
    stock: Number.isFinite(node.totalInventory) ? Number(node.totalInventory) : 0,
    finish: "Connected product",
    material: "Shopify product",
    width: 100,
    description: stripHtml(node.description || node.descriptionHtml || "Connected from the development storefront."),
    art: demoProducts[index % demoProducts.length]?.art || "walnut",
    tag: "Live catalogue",
  };
};

const fallback = (warning?: string) => Response.json({ source: "demo", mode: "preview-only", store: shopifyPreviewStore, products: demoProducts.map((product) => ({ ...product, cost: null })), warning });

export async function GET(request: Request) {
  const auth = await merchantContextOrResponse(request, "VIEWER");
  if ("response" in auth) return auth.response;
  const limit = await consumeRateLimit("CATALOG_IMPORT", auth.context);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  const domain = getEnv("SHOPIFY_STORE_DOMAIN") || shopifyPreviewStore.url.replace("https://", "");
  const storefrontToken = getEnv("SHOPIFY_STOREFRONT_ACCESS_TOKEN");
  const adminToken = (await getStoredShopifyAdminAccessToken(auth.context.organizationId, normalizeShopDomain(domain)).catch(() => null)) || getEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
  const token = storefrontToken || adminToken;
  if (!token) {
    if (getEnv("NODE_ENV") === "production") return Response.json({ error: "PRODUCTION_CATALOG_NOT_CONFIGURED", code: "PRODUCTION_CATALOG_NOT_CONFIGURED" }, { status: 503 });
    return fallback("Add a Shopify Storefront or Admin access token to enable live catalogue sync.");
  }

  const apiVersion = getEnv("SHOPIFY_API_VERSION") || "2026-07";
  const adminMode = !storefrontToken && Boolean(adminToken);
  const endpoint = adminMode ? `https://${domain}/admin/api/${apiVersion}/graphql.json` : `https://${domain}/api/${apiVersion}/graphql.json`;
  const query = adminMode
    ? "query AgentFlowCatalogue { products(first: 50) { nodes { id title handle descriptionHtml totalInventory variants(first: 1) { nodes { price sku } } } } }"
    : "query AgentFlowCatalogue { products(first: 50) { nodes { id title handle description variants(first: 1) { nodes { price sku } } totalInventory } } }";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(adminMode ? { "X-Shopify-Access-Token": token } : { "X-Shopify-Storefront-Access-Token": token }) },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`Shopify returned ${response.status}`);
    const payload = await response.json() as { data?: { products?: { nodes?: LiveProductNode[] } }; errors?: unknown[] };
    if (payload.errors?.length || !payload.data?.products?.nodes?.length) throw new Error("Shopify returned no catalogue nodes");
    return Response.json({ source: "shopify", mode: adminMode ? "live-admin" : "live", store: { ...shopifyPreviewStore, domain }, products: payload.data.products.nodes.map(mapLiveProduct) });
  } catch (error) {
    console.error("Shopify catalogue sync unavailable", error instanceof Error ? error.message : "unknown error");
    if (getEnv("NODE_ENV") === "production") return Response.json({ error: "Shopify catalogue sync is unavailable.", code: "SHOPIFY_CATALOG_UNAVAILABLE" }, { status: 503 });
    return fallback("Shopify catalogue sync is unavailable; showing the safe preview catalogue.");
  }
}
