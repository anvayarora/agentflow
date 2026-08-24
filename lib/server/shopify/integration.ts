import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { integrations } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";
import { configuredShopDomain, normalizeShopDomain, type ShopifyCapabilitySnapshot } from "./ucp";

export const SHOPIFY_PROVIDER = "SHOPIFY";
const integrationId = "integration_shopify_haven_home";

export type ShopifyIntegrationRecord = {
  id: string;
  organizationId: string;
  provider: typeof SHOPIFY_PROVIDER;
  shopDomain: string;
  status: string;
  capabilities: ShopifyCapabilitySnapshot | null;
  installedAt?: string;
  lastVerifiedAt?: string;
};

const now = () => new Date().toISOString();

function baseConfiguration(shopDomain: string) {
  return { shopDomain, source: "shopify_ucp", appProxyPath: "/apps/agentflow", ucpEndpoint: `https://${shopDomain}/api/ucp/mcp` };
}

export async function resolveShopifyIntegration(shopDomain: string, organizationId: string): Promise<ShopifyIntegrationRecord | null> {
  const normalized = normalizeShopDomain(shopDomain);
  if (normalized !== configuredShopDomain()) return null;
  if (!isDatabaseConfigured()) return { id: integrationId, organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: "DISCOVERED", capabilities: null };
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, organizationId), eq(integrations.provider, SHOPIFY_PROVIDER))).limit(1);
  const row = rows[0];
  if (row) {
    const configuration = row.configuration || {};
    if (configuration.shopDomain !== normalized) return null;
    return { id: row.id, organizationId: row.organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: row.status, capabilities: (configuration.capabilities as ShopifyCapabilitySnapshot | null) || null, installedAt: row.createdAt.toISOString(), lastVerifiedAt: typeof configuration.lastVerifiedAt === "string" ? configuration.lastVerifiedAt : undefined };
  }
  await getDb().insert(integrations).values({ id: integrationId, organizationId, provider: SHOPIFY_PROVIDER, status: "DISCOVERED", configuration: baseConfiguration(normalized) }).onConflictDoNothing();
  return { id: integrationId, organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: "DISCOVERED", capabilities: null };
}

export async function persistShopifyCapabilitySnapshot(context: TrustedRequestContext, snapshot: ShopifyCapabilitySnapshot) {
  const integration = await resolveShopifyIntegration(snapshot.shopDomain, context.organizationId);
  if (!integration || !isDatabaseConfigured()) return { ...integration, capabilities: snapshot, status: "SHOPIFY_UCP_CONNECTED", lastVerifiedAt: snapshot.verifiedAt };
  const configuration = { ...baseConfiguration(snapshot.shopDomain), capabilities: snapshot, lastVerifiedAt: snapshot.verifiedAt };
  await getDb().update(integrations).set({ status: "SHOPIFY_UCP_CONNECTED", configuration, updatedAt: new Date() }).where(and(eq(integrations.organizationId, context.organizationId), eq(integrations.id, integration.id)));
  return { ...integration, capabilities: snapshot, status: "SHOPIFY_UCP_CONNECTED", lastVerifiedAt: snapshot.verifiedAt };
}

export function shopifyIntegrationConfiguration(shopDomain = configuredShopDomain()) {
  return { ...baseConfiguration(shopDomain), createdAt: now() };
}
