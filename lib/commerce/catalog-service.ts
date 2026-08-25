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

function liveShopify() { return ["shopify", "shopify_ucp"].includes((process.env.CATALOG_PROVIDER || "demo").toLowerCase()); }

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

export async function searchProducts(context: TrustedRequestContext, session: SessionRecord, input: { query: string; limit?: number; category?: string; maxPricePaise?: number }) {
  if (liveShopify()) {
    const result = await ucpClient(session).searchCatalog(input.query, { limit: input.limit });
    return result.products.filter((product): product is ShopifyUcpProduct => Boolean(product)).map(toPublicShopifyProduct).filter((product) => !input.category || product.tags.includes(input.category) || product.collections.some((collection) => collection.title === input.category));
  }
  const products = await getCommerceRepository().listProducts(context);
  return products.filter((product) => {
    const haystack = `${product.name} ${product.description} ${product.category} ${product.brand || ""} ${product.tags.join(" ")}`.toLowerCase();
    return haystack.includes(input.query.toLowerCase()) && (!input.category || product.category.toLowerCase() === input.category.toLowerCase()) && (input.maxPricePaise === undefined || product.listPricePaise <= input.maxPricePaise);
  }).slice(0, input.limit || 5).map(toPublicProduct);
}

export async function getProduct(context: TrustedRequestContext, session: SessionRecord, productId: string) {
  if (liveShopify()) {
    const result = await ucpClient(session).getProduct(productId);
    return result.product ? toPublicShopifyProduct(result.product) : null;
  }
  const product = await getCommerceRepository().getProduct(context, productId);
  return product ? toPublicProduct(product) : null;
}

export async function compareProducts(context: TrustedRequestContext, session: SessionRecord, productIds: string[]) {
  if (liveShopify()) return (await ucpClient(session).lookupCatalog(productIds)).products.filter((product): product is ShopifyUcpProduct => Boolean(product)).map(toPublicShopifyProduct);
  const repository = getCommerceRepository();
  return (await Promise.all(productIds.map((productId) => repository.getProduct(context, productId)))).filter((product): product is NonNullable<typeof product> => Boolean(product)).map(toPublicProduct);
}

export async function getInventory(context: TrustedRequestContext, session: SessionRecord, productId: string, variantId?: string) {
  if (liveShopify()) {
    const product = await getProduct(context, session, productId);
    if (!product || !("variants" in product)) return { productId, variantId, available: false };
    const variant = product.variants.find((item) => !variantId || item.id === variantId);
    return { productId, variantId: variant?.id || undefined, available: variant?.available === true };
  }
  const product = await getCommerceRepository().getProduct(context, productId);
  return product ? { productId, available: product.stock > 0, quantityAvailable: product.stock } : { productId, available: false };
}

export async function getCart(context: TrustedRequestContext, session: SessionRecord) {
  if (liveShopify() && session.shopifyCartId) return publicCart(await ucpClient(session).getCart(session.shopifyCartId), session.shopifyShopDomain || undefined);
  return demoCart(session);
}

export async function updateCart(context: TrustedRequestContext, session: SessionRecord, lines: Array<{ variantId: string; quantity: number }>) {
  const repository = getCommerceRepository();
  if (liveShopify() && session.shopifyShopDomain) {
    const client = ucpClient(session);
    const cart = session.shopifyCartId ? await client.updateCart(session.shopifyCartId, { lineItems: lines }) : await client.createCart(lines);
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
