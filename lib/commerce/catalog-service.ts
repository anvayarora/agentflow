import { hashCart, type CanonicalCart, type CanonicalCartLine } from "./cart";
import { toPublicProduct } from "../domain/catalogue";
import { getCommerceRepository, type SessionRecord } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getShopifyUcpClient, toPublicShopifyProduct, type ShopifyUcpCart, type ShopifyUcpProduct } from "../server/shopify/ucp";

export type PublicCart = {
  id?: string;
  currency: string;
  lines: Array<{ id?: string; variantId: string; title?: string; quantity: number; unitPriceMinorUnits?: number }>;
  totalMinorUnits: number;
  continueUrl?: string;
  messages?: Array<Record<string, unknown>>;
  cartHash: string;
};

function liveShopify(session?: SessionRecord) {
  const provider = (process.env.CATALOG_PROVIDER || "demo").toLowerCase();
  if (process.env.NODE_ENV === "production" && provider !== "shopify" && provider !== "shopify_ucp") throw new Error("PRODUCTION_CATALOG_NOT_CONFIGURED");
  if (process.env.NODE_ENV === "production" && !session?.shopifyShopDomain) throw new Error("PRODUCTION_SHOPIFY_SESSION_REQUIRED");
  return ["shopify", "shopify_ucp"].includes(provider) && Boolean(session?.shopifyShopDomain);
}

function cartTotal(cart: ShopifyUcpCart) { return cart.totals.find((total) => total.type === "total")?.amount || 0; }

function publicCart(cart: ShopifyUcpCart, shopDomain?: string): PublicCart {
  const canonical: CanonicalCart = { shopDomain, currency: cart.currency || "USD", lines: cart.lineItems.map((line) => ({ variantId: line.item.id, lineItemId: line.id, quantity: line.quantity, unitPricePaise: cart.currency === "INR" ? line.item.priceMinorUnits : undefined })) };
  return { id: cart.id, currency: cart.currency || "USD", lines: cart.lineItems.map((line) => ({ id: line.id, variantId: line.item.id, title: line.item.title, quantity: line.quantity, unitPriceMinorUnits: line.item.priceMinorUnits })), totalMinorUnits: cartTotal(cart), continueUrl: cart.continueUrl, messages: cart.messages, cartHash: hashCart(canonical) };
}

function demoCart(session: SessionRecord): PublicCart {
  const lines = (session.canonicalLineItems || []).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const line = value as Record<string, unknown>;
    return typeof line.variantId === "string" && typeof line.quantity === "number" ? [{ variantId: line.variantId, quantity: line.quantity, title: typeof line.title === "string" ? line.title : undefined, unitPriceMinorUnits: typeof line.unitPricePaise === "number" ? line.unitPricePaise : undefined }] : [];
  });
  const canonical: CanonicalCart = { currency: session.currency, lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPricePaise: line.unitPriceMinorUnits })) };
  return { currency: session.currency, lines, totalMinorUnits: session.cartTotalPaise, cartHash: hashCart(canonical) };
}

function ucpClient(session: SessionRecord) {
  if (!session.shopifyShopDomain) throw new Error("Shopify session is not linked to a shop.");
  return getShopifyUcpClient({ shopDomain: session.shopifyShopDomain });
}

export type ShopperConstraints = { query: string; limit?: number; category?: string; maxPricePaise?: number; maxWidthCm?: number; material?: string; finish?: string; excludeFrameType?: string; availability?: "in_stock" };

function textForProduct(product: ShopifyUcpProduct | { name: string; description: string; category: string; brand?: string | null; tags: string[]; attributes: Record<string, unknown> }) {
  if ("title" in product) return `${product.title} ${product.description} ${product.tags.join(" ")} ${product.collections.map((collection) => collection.title || "").join(" ")} ${JSON.stringify(product.raw)}`.toLowerCase();
  return `${product.name} ${product.description} ${product.category} ${product.brand || ""} ${product.tags.join(" ")} ${JSON.stringify(product.attributes)}`.toLowerCase();
}

function extractedWidthCm(product: ShopifyUcpProduct | { attributes: Record<string, unknown>; description: string; name: string }) {
  const raw = "raw" in product ? product.raw : product.attributes;
  const serialized = JSON.stringify(raw);
  const keyMatch = serialized.match(/(?:width|breadth|wide)[^0-9]{0,24}(\d+(?:\.\d+)?)/i);
  const productName = "title" in product ? product.title : product.name;
  const textMatch = `${productName} ${product.description}`.match(/(?:width|wide|breadth)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:cm|centimet(?:er|re))?/i);
  const value = keyMatch?.[1] || textMatch?.[1];
  return value ? Number(value) : null;
}

function matchesShopperConstraints(product: ShopifyUcpProduct | { name: string; description: string; category: string; brand?: string | null; tags: string[]; attributes: Record<string, unknown>; listPricePaise: number; currency: string; stock: number }, input: ShopperConstraints) {
  const haystack = textForProduct(product);
  if (input.category && !haystack.includes(input.category.toLowerCase())) return false;
  if (input.maxPricePaise !== undefined) {
    const price = "priceMinorUnits" in product ? product.priceMinorUnits : product.listPricePaise;
    const currency = "priceMinorUnits" in product ? product.currency : product.currency;
    if (currency.toUpperCase() !== "INR" || price > input.maxPricePaise) return false;
  }
  if (input.material && !haystack.includes(input.material.toLowerCase())) return false;
  if (input.finish && !haystack.includes(input.finish.toLowerCase())) return false;
  if (input.excludeFrameType && haystack.includes(input.excludeFrameType.toLowerCase())) return false;
  if (input.maxWidthCm !== undefined) {
    const width = extractedWidthCm(product);
    if (width === null || width > input.maxWidthCm) return false;
  }
  if (input.availability === "in_stock") {
    if ("priceMinorUnits" in product) {
      if (product.variants.length > 0 && !product.variants.some((variant) => variant.available !== false)) return false;
    } else if (product.stock <= 0) return false;
  }
  return true;
}

function queryTokens(query: string) {
  return query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length > 1 && !["the", "and", "for", "with", "from", "under", "below", "show", "me", "please", "mujhe", "chahiye", "ke", "liye", "hai", "do", "ek", "a", "an"].includes(token));
}

function queryMatchesProduct(product: ShopifyUcpProduct | { name: string; description: string; category: string; brand?: string | null; tags: string[]; attributes: Record<string, unknown> }, query: string) {
  const haystack = textForProduct(product);
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const synonyms: Record<string, string[]> = {
    desk: ["desk", "workspace", "home office", "writing"],
    table: ["table", "desk", "console"],
    wood: ["wood", "walnut", "oak", "veneer", "ash", "cane"],
    wooden: ["wood", "walnut", "oak", "veneer", "ash"],
    dark: ["dark", "walnut", "smoked", "charcoal", "black"],
    work: ["work", "desk", "workspace", "office"],
    home: ["home", "office", "living", "bedroom"],
    accessory: ["accessor", "lamp", "organizer", "tray", "lighting"],
    accessories: ["accessor", "lamp", "organizer", "tray", "lighting"],
    lamp: ["lamp", "lighting"],
    sofa: ["sofa", "couch"],
    bed: ["bed", "bedroom"],
  };
  const matches = tokens.filter((token) => (synonyms[token] || [token]).some((candidate) => haystack.includes(candidate)));
  return matches.length >= Math.max(1, Math.ceil(tokens.length * 0.45));
}

function normalizedSearchInput(input: ShopperConstraints): ShopperConstraints {
  return { ...input, availability: "in_stock" };
}

export async function searchProducts(context: TrustedRequestContext, session: SessionRecord, input: ShopperConstraints) {
  const constraints = normalizedSearchInput(input);
  if (liveShopify(session)) {
    const result = await ucpClient(session).searchCatalog(constraints.query, { limit: Math.max(constraints.limit || 5, 10) });
    return result.products.filter((product): product is ShopifyUcpProduct => Boolean(product)).filter((product) => queryMatchesProduct(product, constraints.query) && matchesShopperConstraints(product, constraints)).map(toPublicShopifyProduct).slice(0, constraints.limit || 5);
  }
  const products = await getCommerceRepository().listProducts(context);
  return products.filter((product) => queryMatchesProduct(product, constraints.query) && matchesShopperConstraints(product, constraints)).sort((a, b) => b.stock - a.stock).slice(0, constraints.limit || 5).map(toPublicProduct);
}

/** Returns complementary products for a known product context. The category
 * and exclusion checks happen after retrieval so the model cannot broaden an
 * accessory request into unrelated primary furniture. */
export async function searchComplementaryProducts(context: TrustedRequestContext, session: SessionRecord, currentProduct: { id: string; name?: string; title?: string; category?: string; tags?: string[] }) {
  const source = `${currentProduct.name || currentProduct.title || "product"} ${currentProduct.category || ""} ${(currentProduct.tags || []).join(" ")}`.toLowerCase();
  const query = /desk|workspace|office/.test(source) ? "desk lamp organizer tray accessories" : /chair|seat/.test(source) ? "lamp side table accessories" : /bed|bedroom/.test(source) ? "bedside lamp table accessories" : "home accessories lamp organizer";
  const excluded = /sofa|bed|dining table|dresser|console|coffee table|media console/;
  const accepted = /desk|workspace|office/.test(source) ? /lamp|lighting|organizer|tray|desk chair|chair/ : /chair|seat/.test(source) ? /lamp|lighting|side table|accessor/ : /bed|bedroom/.test(source) ? /bedside|lamp|lighting|side table/ : /lamp|lighting|accessor|organizer|tray/;
  const productIsAccessory = (product: ShopifyUcpProduct | { name: string; description: string; category: string; tags: string[]; attributes: Record<string, unknown> }) => {
    const text = textForProduct(product);
    return !excluded.test(text) && accepted.test(text);
  };
  const products = liveShopify(session)
    ? (await ucpClient(session).searchCatalog(query, { limit: 20 })).products.filter((product): product is ShopifyUcpProduct => Boolean(product)).filter(productIsAccessory).map(toPublicShopifyProduct)
    : (await getCommerceRepository().listProducts(context)).filter((product) => product.id !== currentProduct.id && productIsAccessory(product)).map(toPublicProduct);
  const seen = new Set<string>();
  return products.filter((product) => { if (product.id === currentProduct.id || seen.has(product.id)) return false; seen.add(product.id); return true; }).slice(0, 6);
}

export async function getProduct(context: TrustedRequestContext, session: SessionRecord, productId: string) {
  if (liveShopify(session)) {
    const normalizedId = /^\d+$/.test(productId) ? `gid://shopify/Product/${productId}` : productId;
    const result = await ucpClient(session).getProduct(normalizedId);
    return result.product ? toPublicShopifyProduct(result.product) : null;
  }
  const product = await getCommerceRepository().getProduct(context, productId);
  return product ? toPublicProduct(product) : null;
}

export async function compareProducts(context: TrustedRequestContext, session: SessionRecord, productIds: string[]) {
  if (liveShopify(session)) return (await ucpClient(session).lookupCatalog(productIds)).products.filter((product): product is ShopifyUcpProduct => Boolean(product)).map(toPublicShopifyProduct);
  const repository = getCommerceRepository();
  return (await Promise.all(productIds.map((productId) => repository.getProduct(context, productId)))).filter((product): product is NonNullable<typeof product> => Boolean(product)).map(toPublicProduct);
}

export async function getInventory(context: TrustedRequestContext, session: SessionRecord, productId: string, variantId?: string) {
  if (liveShopify(session)) {
    const product = await getProduct(context, session, productId);
    if (!product || !("variants" in product)) return { productId, variantId, available: false };
    const variant = product.variants.find((item) => !variantId || item.id === variantId);
    return { productId, variantId: variant?.id || undefined, available: variant?.available === true };
  }
  const product = await getCommerceRepository().getProduct(context, productId);
  return product ? { productId, available: product.stock > 0, quantityAvailable: product.stock } : { productId, available: false };
}

export async function getCart(context: TrustedRequestContext, session: SessionRecord) {
  if (liveShopify(session) && session.shopifyCartId) return publicCart(await ucpClient(session).getCart(session.shopifyCartId), session.shopifyShopDomain || undefined);
  return demoCart(session);
}

export async function updateCart(context: TrustedRequestContext, session: SessionRecord, lines: Array<{ variantId: string; quantity: number }>) {
  const repository = getCommerceRepository();
  if (liveShopify(session) && session.shopifyShopDomain) {
    const client = ucpClient(session);
    let cart: ShopifyUcpCart;
    if (session.shopifyCartId) {
      // UCP update_cart is line-item-id based. Reconcile variant references
      // with the live cart before writing so existing lines are preserved and
      // quantity changes cannot silently replace the cart.
      const current = await client.getCart(session.shopifyCartId);
      const lineItems = lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, lineItemId: current.lineItems.find((item) => item.item.id === line.variantId)?.id }));
      cart = await client.updateCart(session.shopifyCartId, { lineItems });
    } else {
      cart = await client.createCart(lines);
    }
    const nextCart = publicCart(cart, session.shopifyShopDomain);
    await repository.updateSessionCart(context, session.id, { currency: cart.currency || session.currency, cartTotalPaise: cart.currency === "INR" ? cartTotal(cart) : 0, shopifyCartId: cart.id, canonicalLineItems: cart.lineItems, cartHash: nextCart.cartHash });
    return nextCart;
  }
  const products = await repository.listProducts(context);
  const canonicalLines: CanonicalCartLine[] = [];
  for (const line of lines) {
    const product = products.find((item) => item.id === line.variantId || item.sku === line.variantId);
    if (!product) throw new Error("That product is not available in this catalogue.");
    if (line.quantity > product.stock) throw new Error("That quantity is not currently in stock.");
    canonicalLines.push({ productId: product.id, variantId: product.id, quantity: line.quantity, sku: product.sku, unitPricePaise: product.listPricePaise });
  }
  const total = canonicalLines.reduce((sum, line) => sum + (line.unitPricePaise || 0) * line.quantity, 0);
  const canonical: CanonicalCart = { currency: session.currency, lines: canonicalLines };
  await repository.updateSessionCart(context, session.id, { cartTotalPaise: total, canonicalLineItems: canonicalLines, cartHash: hashCart(canonical) });
  return { currency: session.currency, lines: canonicalLines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPriceMinorUnits: line.unitPricePaise })), totalMinorUnits: total, cartHash: hashCart(canonical) };
}
