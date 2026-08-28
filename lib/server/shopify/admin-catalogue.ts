import { createHash } from "node:crypto";
import type { TrustedRequestContext } from "../context";
import { getCommerceRepository } from "../repositories/commerce";
import { upsertProductMapping } from "../repositories/bootstrap";
import { normalizeShopDomain, configuredShopDomain } from "./ucp";
import type { CatalogueImportRow } from "../../bootstrap/catalogue";

export class ShopifyAdminError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code = "SHOPIFY_ADMIN_ERROR", status?: number) { super(message); this.name = "ShopifyAdminError"; this.code = code; this.status = status; }
}

type Json = Record<string, unknown>;
const env = () => (typeof process === "undefined" ? undefined : process.env);
const apiVersion = () => env()?.SHOPIFY_API_VERSION || "2026-07";
const shopDomain = () => normalizeShopDomain(env()?.SHOPIFY_STORE_DOMAIN || configuredShopDomain());
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || createHash("sha256").update(value).digest("hex").slice(0, 16);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);

export type ShopifySyncResult = {
  shopDomain: string;
  mode: "live-admin";
  productsCreated: number;
  productsUpdated: number;
  variants: number;
  inventory: { sourceOfTruth: "shopify" | "agentflow"; status: "not-written" | "written" | "blocked" };
  mappings: Awaited<ReturnType<typeof upsertProductMapping>>[];
  errors: Array<{ sku: string; message: string }>;
};

const mutation = `mutation AgentFlowProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
  productSet(input: $input, identifier: $identifier, synchronous: true) {
    product { id title variants(first: 100) { nodes { id sku } } }
    userErrors { field message code }
  }
}`;

async function graphQL(query: string, variables: Json): Promise<Json> {
  const token = env()?.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new ShopifyAdminError("A Shopify Admin access token is required for catalogue bootstrap.", "SHOPIFY_ADMIN_NOT_CONFIGURED", 424);
  const response = await fetch(`https://${shopDomain()}/admin/api/${apiVersion()}/graphql.json`, { method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new ShopifyAdminError(`Shopify Admin GraphQL returned HTTP ${response.status}.`, "SHOPIFY_ADMIN_HTTP_ERROR", response.status);
  if (Array.isArray(payload.errors) && payload.errors.length) throw new ShopifyAdminError("Shopify Admin GraphQL rejected the request.", "SHOPIFY_ADMIN_GRAPHQL_ERROR", 400);
  return payload;
}

function productInput(rows: CatalogueImportRow[]) {
  const first = rows[0];
  const variantValues = [...new Set(rows.map((row) => row.variant).filter((value): value is string => Boolean(value)))];
  const publicMetafields = [
    ["material", first.material],
    ["colour", first.colour],
    ["dimensions", first.dimensions],
  ].flatMap(([key, value]) => value ? [{ namespace: "agentflow", key, type: "single_line_text_field", value }] : []);
  return {
    title: first.productName,
    handle: slug(first.sku),
    descriptionHtml: escapeHtml(first.description),
    productType: first.category,
    vendor: first.brand || undefined,
    tags: first.internalTags,
    ...(variantValues.length > 1 ? { productOptions: [{ name: "Variant", position: 1, values: variantValues.map((name) => ({ name })) }] } : {}),
    ...(publicMetafields.length ? { metafields: publicMetafields } : {}),
    variants: rows.map((row) => ({ sku: row.sku, price: (row.pricePaise / 100).toFixed(2), ...(row.variant ? { optionValues: [{ optionName: "Variant", name: row.variant }] } : {}), ...(row.imageUrl ? { file: { originalSource: row.imageUrl, alt: row.productName, filename: `${slug(row.sku)}.jpg`, contentType: "IMAGE" } } : {}) })),
    ...(first.imageUrl ? { files: [{ originalSource: first.imageUrl, alt: first.productName, filename: `${slug(first.sku)}.jpg`, contentType: "IMAGE" }] } : {}),
  };
}

/**
 * Syncs reviewed rows using Admin GraphQL productSet. AgentFlow only owns
 * inventory when AGENTFLOW_CATALOGUE_INVENTORY_SOURCE=agentflow; otherwise
 * Shopify remains the inventory source and no absolute quantity is written.
 */
export async function syncCatalogueRows(context: TrustedRequestContext, rows: CatalogueImportRow[], options: { shopDomain?: string } = {}): Promise<ShopifySyncResult> {
  const targetShop = normalizeShopDomain(options.shopDomain || shopDomain());
  if (targetShop !== shopDomain()) throw new ShopifyAdminError("Catalogue sync target is not the configured Shopify development store.", "SHOP_DOMAIN_MISMATCH", 403);
  const repository = getCommerceRepository();
  const result: ShopifySyncResult = { shopDomain: targetShop, mode: "live-admin", productsCreated: 0, productsUpdated: 0, variants: 0, inventory: { sourceOfTruth: env()?.AGENTFLOW_CATALOGUE_INVENTORY_SOURCE === "agentflow" ? "agentflow" : "shopify", status: "not-written" }, mappings: [], errors: [] };
  const grouped = new Map<string, CatalogueImportRow[]>();
  for (const row of rows) { const key = row.productName.trim().toLowerCase(); grouped.set(key, [...(grouped.get(key) || []), row]); }
  for (const productRows of grouped.values()) {
    const first = productRows[0];
    try {
      const savedProducts = await Promise.all(productRows.map((row) => repository.upsertCatalogueProduct(context, { sku: row.sku, externalId: row.externalId, name: row.productName, description: row.description, category: row.category, brand: row.brand, currency: "INR", listPricePaise: row.pricePaise, costPaise: row.costPaise, stock: row.inventory, imageUrl: row.imageUrl, tags: row.internalTags, source: "shopify-bootstrap", attributes: { colour: row.colour, material: row.material, dimensions: row.dimensions, variant: row.variant, collection: row.collection, supplier: row.supplier } })));
      const payload = await graphQL(mutation, { input: productInput(productRows), identifier: { handle: slug(first.sku) } });
      const productSet = (payload.data as Json | undefined)?.productSet as Json | undefined;
      const userErrors = Array.isArray(productSet?.userErrors) ? productSet.userErrors as Json[] : [];
      if (userErrors.length) throw new ShopifyAdminError("Shopify rejected one or more catalogue fields.", "SHOPIFY_PRODUCT_SET_ERROR", 400);
      const product = productSet?.product as Json | undefined;
      const productGid = typeof product?.id === "string" ? product.id : undefined;
      if (!productGid) throw new ShopifyAdminError("Shopify did not return a product ID.", "SHOPIFY_PRODUCT_SET_NO_PRODUCT", 502);
      const variants = ((product?.variants as Json | undefined)?.nodes as Json[] | undefined) || [];
      result.variants += productRows.length;
      for (const saved of savedProducts) {
        const variant = variants.find((entry) => entry.sku === saved.sku);
        result.mappings.push(await upsertProductMapping(context, { productId: saved.id, shopDomain: targetShop, shopifyProductGid: productGid, shopifyVariantGid: typeof variant?.id === "string" ? variant.id : null, sku: saved.sku, source: "productSet" }));
      }
      result.productsUpdated += 1;
    } catch (error) {
      for (const row of productRows) result.errors.push({ sku: row.sku, message: error instanceof Error ? error.message : "Shopify catalogue sync failed." });
    }
  }
  if (result.inventory.sourceOfTruth === "agentflow") {
    // Absolute inventory writes require inventory item/location IDs and a
    // compare-and-set mutation. They are intentionally not guessed here.
    result.inventory.status = "blocked";
  }
  result.productsCreated = result.productsUpdated;
  return result;
}
