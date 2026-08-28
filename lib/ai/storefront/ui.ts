import { z } from "zod";

const productId = z.string().trim().min(1).max(255);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VIEW_PRODUCT"), productId, href: z.string().url().optional() }).strict(),
  z.object({ type: z.literal("COMPARE_PRODUCTS"), productIds: z.array(productId).min(2).max(4) }).strict(),
  z.object({ type: z.literal("ADD_TO_SHORTLIST"), productId }).strict(),
  z.object({ type: z.literal("REMOVE_FROM_SHORTLIST"), productId }).strict(),
  z.object({ type: z.literal("ADD_TO_CART"), productId, variantId: productId.optional() }).strict(),
  z.object({ type: z.literal("OPEN_CART") }).strict(),
  z.object({ type: z.literal("ACCEPT_OFFER"), offerId: productId }).strict(),
  z.object({ type: z.literal("CHECKOUT") }).strict(),
]);
export const storefrontUiActionSchema = actionSchema;
export type StorefrontUiAction = z.infer<typeof actionSchema>;

const base = z.object({ message: z.string().max(2_000), actions: z.array(actionSchema).max(20) }).strict();
export const storefrontUiSurfaceSchema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("TEXT") }),
  base.extend({ type: z.literal("PRODUCT_GRID"), productIds: z.array(productId).max(20) }),
  base.extend({ type: z.literal("PRODUCT_SPOTLIGHT"), productIds: z.array(productId).min(1).max(4) }),
  base.extend({ type: z.literal("SHORTLIST"), productIds: z.array(productId).max(12) }),
  base.extend({ type: z.literal("COMPARISON"), productIds: z.array(productId).min(2).max(4) }),
  base.extend({ type: z.literal("CART_UPDATE"), productIds: z.array(productId).max(20) }),
  base.extend({ type: z.literal("BUNDLE_OFFER"), productIds: z.array(productId).max(4), offerId: productId.optional() }),
  base.extend({ type: z.literal("PRIVATE_OFFER"), productIds: z.array(productId).max(4), offerId: productId.optional() }),
  base.extend({ type: z.literal("COUNTER_OFFER"), productIds: z.array(productId).max(4), offerId: productId.optional() }),
  base.extend({ type: z.literal("APPROVAL_WAIT"), productIds: z.array(productId).max(4), approvalId: productId.optional() }),
  base.extend({ type: z.literal("CHECKOUT"), productIds: z.array(productId).max(20) }),
  base.extend({ type: z.literal("PAYMENT_RESULT"), productIds: z.array(productId).max(20) }),
  base.extend({ type: z.literal("ERROR") }),
]);
export type StorefrontUiSurface = z.infer<typeof storefrontUiSurfaceSchema>;

function publicId(product: unknown): string | null {
  if (!product || typeof product !== "object") return null;
  const value = product as Record<string, unknown>;
  return typeof value.id === "string" ? value.id : null;
}

export function projectStorefrontUi(input: { message: string; products?: unknown[]; cart?: unknown | null; offer?: { offerId?: string; outcome?: string } | null; approval?: { approvalId?: string } | null; checkout?: unknown | null; shortlistProductIds?: string[] }): StorefrontUiSurface {
  const productIds = (input.products || []).map(publicId).filter((id): id is string => Boolean(id)).slice(0, 20);
  const text = input.message.toLowerCase();
  const actions: StorefrontUiAction[] = productIds.slice(0, 4).map((id) => ({ type: "VIEW_PRODUCT", productId: id }));
  if (text.includes("compare") && productIds.length >= 2) return storefrontUiSurfaceSchema.parse({ type: "COMPARISON", message: input.message, productIds: productIds.slice(0, 4), actions: [{ type: "COMPARE_PRODUCTS", productIds: productIds.slice(0, 4) }, ...actions] });
  if ((text.includes("first one") || text.includes("show me the first") || text.includes("open the first")) && productIds.length) return storefrontUiSurfaceSchema.parse({ type: "PRODUCT_SPOTLIGHT", message: input.message, productIds: productIds.slice(0, 1), actions });
  if (input.checkout) return storefrontUiSurfaceSchema.parse({ type: "CHECKOUT", message: input.message, productIds, actions: [{ type: "CHECKOUT" }] });
  if (input.approval) return storefrontUiSurfaceSchema.parse({ type: "APPROVAL_WAIT", message: input.message, productIds, approvalId: input.approval.approvalId, actions });
  if (input.offer) {
    const type = input.offer.outcome === "COUNTER" ? "COUNTER_OFFER" : input.offer.outcome === "ALLOW" ? "PRIVATE_OFFER" : input.offer.outcome === "ESCALATE" ? "APPROVAL_WAIT" : "ERROR";
    return storefrontUiSurfaceSchema.parse({ type, message: input.message, productIds, offerId: input.offer.offerId, actions });
  }
  if (input.cart) return storefrontUiSurfaceSchema.parse({ type: "CART_UPDATE", message: input.message, productIds, actions: [{ type: "OPEN_CART" }, ...actions] });
  if (input.shortlistProductIds?.length) return storefrontUiSurfaceSchema.parse({ type: "SHORTLIST", message: input.message, productIds: input.shortlistProductIds, actions: input.shortlistProductIds.slice(0, 4).map((id) => ({ type: "VIEW_PRODUCT", productId: id })) });
  if (productIds.length) return storefrontUiSurfaceSchema.parse({ type: "PRODUCT_GRID", message: input.message, productIds, actions });
  return storefrontUiSurfaceSchema.parse({ type: "TEXT", message: input.message, actions: [] });
}

export function uiActionFromClient(value: unknown): StorefrontUiAction { return actionSchema.parse(value); }
