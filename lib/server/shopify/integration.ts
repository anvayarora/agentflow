import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../../../db";
import { integrations } from "../../../db/schema";
import type { TrustedRequestContext } from "../context";
import { configuredShopDomain, normalizeShopDomain, type ShopifyCapabilitySnapshot } from "./ucp";

export const SHOPIFY_PROVIDER = "SHOPIFY";

type EncryptedShopifyToken = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

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
const integrationIdFor = (organizationId: string, shopDomain: string) => `integration_shopify_${createHash("sha256").update(`${organizationId}:${shopDomain}`).digest("hex").slice(0, 24)}`;

function baseConfiguration(shopDomain: string) {
  return { shopDomain, source: "shopify_ucp", appProxyPath: "/apps/agentflow", ucpEndpoint: `https://${shopDomain}/api/ucp/mcp` };
}

function tokenKey(source?: string) {
  const environment = typeof process === "undefined" ? undefined : process.env;
  const secret = source || environment?.DATA_ENCRYPTION_KEY || (environment?.NODE_ENV === "production" ? undefined : environment?.SHOPIFY_API_SECRET);
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY is required to protect the Shopify Admin token.");
  return createHash("sha256").update(secret).digest();
}

function encryptToken(token: string): EncryptedShopifyToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

function decryptToken(value: unknown): { token: string; legacy: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sealed = value as Partial<EncryptedShopifyToken>;
  if (sealed.version !== 1 || typeof sealed.iv !== "string" || typeof sealed.tag !== "string" || typeof sealed.ciphertext !== "string") return null;
  const environment = typeof process === "undefined" ? undefined : process.env;
  if (environment?.NODE_ENV === "production" && !environment.DATA_ENCRYPTION_KEY) return null;
  const keys = environment?.DATA_ENCRYPTION_KEY ? [{ value: environment.DATA_ENCRYPTION_KEY, legacy: false }] : [];
  if (environment?.SHOPIFY_API_SECRET) keys.push({ value: environment.SHOPIFY_API_SECRET, legacy: true });
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", tokenKey(key.value), Buffer.from(sealed.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
      return { token: Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64url")), decipher.final()]).toString("utf8"), legacy: key.legacy };
    } catch {
      // Try the next key so a legacy token can be migrated without downtime.
    }
  }
  return null;
}

export async function resolveShopifyIntegration(shopDomain: string, organizationId: string): Promise<ShopifyIntegrationRecord | null> {
  const normalized = normalizeShopDomain(shopDomain);
  if (normalized !== configuredShopDomain()) return null;
  const stableId = integrationIdFor(organizationId, normalized);
  if (!isDatabaseConfigured()) return { id: stableId, organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: "DISCOVERED", capabilities: null };
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, organizationId), eq(integrations.provider, SHOPIFY_PROVIDER)));
  const row = rows.find((candidate) => candidate.configuration && (candidate.configuration as Record<string, unknown>).shopDomain === normalized);
  if (row) {
    const configuration = row.configuration || {};
    if (configuration.shopDomain !== normalized) return null;
    return { id: row.id, organizationId: row.organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: row.status, capabilities: (configuration.capabilities as ShopifyCapabilitySnapshot | null) || null, installedAt: row.createdAt.toISOString(), lastVerifiedAt: typeof configuration.lastVerifiedAt === "string" ? configuration.lastVerifiedAt : undefined };
  }
  await getDb().insert(integrations).values({ id: stableId, organizationId, provider: SHOPIFY_PROVIDER, status: "DISCOVERED", configuration: baseConfiguration(normalized) }).onConflictDoNothing();
  return { id: stableId, organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: "DISCOVERED", capabilities: null };
}

/** Resolve tenant ownership from a verified shop domain, never from a client id. */
export async function resolveShopifyIntegrationByDomain(shopDomain: string): Promise<ShopifyIntegrationRecord | null> {
  const normalized = normalizeShopDomain(shopDomain);
  if (!isDatabaseConfigured()) return null;
  const rows = await getDb().select().from(integrations).where(eq(integrations.provider, SHOPIFY_PROVIDER));
  const row = rows.find((candidate) => candidate.configuration && (candidate.configuration as Record<string, unknown>).shopDomain === normalized);
  if (!row) return null;
  const configuration = row.configuration || {};
  return { id: row.id, organizationId: row.organizationId, provider: SHOPIFY_PROVIDER, shopDomain: normalized, status: row.status, capabilities: (configuration.capabilities as ShopifyCapabilitySnapshot | null) || null, installedAt: row.createdAt.toISOString(), lastVerifiedAt: typeof configuration.lastVerifiedAt === "string" ? configuration.lastVerifiedAt : undefined };
}

export async function persistShopifyCapabilitySnapshot(context: TrustedRequestContext, snapshot: ShopifyCapabilitySnapshot) {
  const integration = await resolveShopifyIntegration(snapshot.shopDomain, context.organizationId);
  if (!integration || !isDatabaseConfigured()) return { ...integration, capabilities: snapshot, status: "SHOPIFY_UCP_CONNECTED", lastVerifiedAt: snapshot.verifiedAt };
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, context.organizationId), eq(integrations.id, integration.id))).limit(1);
  const existingConfiguration = rows[0]?.configuration || {};
  const configuration = { ...existingConfiguration, ...baseConfiguration(snapshot.shopDomain), capabilities: snapshot, lastVerifiedAt: snapshot.verifiedAt };
  await getDb().update(integrations).set({ status: "SHOPIFY_UCP_CONNECTED", configuration, updatedAt: new Date() }).where(and(eq(integrations.organizationId, context.organizationId), eq(integrations.id, integration.id)));
  return { ...integration, capabilities: snapshot, status: "SHOPIFY_UCP_CONNECTED", lastVerifiedAt: snapshot.verifiedAt };
}

/** Persist a Shopify offline Admin token without returning or logging its value. */
export async function persistShopifyAdminAccessToken(context: TrustedRequestContext, shopDomain: string, token: string, scopes: string[]) {
  const normalized = normalizeShopDomain(shopDomain);
  if (normalized !== configuredShopDomain()) throw new Error("Shopify authorization is restricted to the configured development store.");
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is required to persist the Shopify Admin token.");
  const integration = await resolveShopifyIntegration(normalized, context.organizationId);
  if (!integration) throw new Error("Shopify integration could not be resolved for this organization.");
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, context.organizationId), eq(integrations.id, integration.id))).limit(1);
  const existingConfiguration = rows[0]?.configuration || baseConfiguration(normalized);
  const configuration = {
    ...existingConfiguration,
    ...baseConfiguration(normalized),
    source: "shopify_oauth_offline",
    shopifyAdminAccessTokenEncrypted: encryptToken(token),
    grantedScopes: [...new Set(scopes)].sort(),
    authorizedAt: now(),
  };
  await getDb().update(integrations).set({ status: "SHOPIFY_ADMIN_CONNECTED", configuration, updatedAt: new Date() }).where(and(eq(integrations.organizationId, context.organizationId), eq(integrations.id, integration.id)));
  return { shopDomain: normalized, provider: SHOPIFY_PROVIDER, status: "SHOPIFY_ADMIN_CONNECTED", grantedScopes: configuration.grantedScopes };
}

/** Read the server-only Admin token from the encrypted integration configuration. */
export async function getStoredShopifyAdminAccessToken(organizationId: string, shopDomain = configuredShopDomain()): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const normalized = normalizeShopDomain(shopDomain);
  if (normalized !== configuredShopDomain()) return null;
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, organizationId), eq(integrations.provider, SHOPIFY_PROVIDER))).limit(1);
  const decrypted = decryptToken(rows[0]?.configuration?.shopifyAdminAccessTokenEncrypted);
  if (decrypted?.legacy && process.env.DATA_ENCRYPTION_KEY && rows[0]) {
    const configuration = { ...(rows[0].configuration || {}), shopifyAdminAccessTokenEncrypted: encryptToken(decrypted.token), encryptedAt: now() };
    await getDb().update(integrations).set({ configuration, updatedAt: new Date() }).where(and(eq(integrations.organizationId, organizationId), eq(integrations.id, rows[0].id)));
  }
  return decrypted?.token || null;
}

export async function getStoredShopifyIntegrationConfiguration(organizationId: string, shopDomain = configuredShopDomain()) {
  if (!isDatabaseConfigured()) return null;
  const normalized = normalizeShopDomain(shopDomain);
  const rows = await getDb().select().from(integrations).where(and(eq(integrations.organizationId, organizationId), eq(integrations.provider, SHOPIFY_PROVIDER))).limit(1);
  const configuration = rows[0]?.configuration;
  if (!configuration || configuration.shopDomain !== normalized) return null;
  return configuration;
}

export function shopifyIntegrationConfiguration(shopDomain = configuredShopDomain()) {
  return { ...baseConfiguration(shopDomain), createdAt: now() };
}
