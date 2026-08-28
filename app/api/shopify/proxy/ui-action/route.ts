import { z } from "zod";
import { getCart, getProduct, updateCart } from "../../../../../lib/commerce/catalog-service";
import { acceptOffer } from "../../../../../lib/commerce/offer-service";
import { createCheckout } from "../../../../../lib/commerce/checkout-service";
import { getBoundShopifySession } from "../../../../../lib/server/shopify/proxy-context";
import { updateShortlist } from "../../../../../lib/ai/storefront/shopper-state";
import { storefrontUiActionSchema } from "../../../../../lib/ai/storefront/ui";
import { buildComparisonMatrix } from "../../../../../lib/ai/storefront/comparison";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../../../../../lib/server/runtime/store";
import type { OfferPayload } from "../../../../../lib/commerce/offer-service";

export const runtime = "nodejs";
const schema = z.object({ sessionId: z.string().trim().min(1).max(255).optional(), action: storefrontUiActionSchema }).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, input.sessionId);
    switch (input.action.type) {
      case "VIEW_PRODUCT":
        return Response.json({ type: input.action.type, product: await getProduct(context, session, input.action.productId) });
      case "ADD_TO_SHORTLIST":
        return Response.json({ type: input.action.type, ...(await updateShortlist(context, session.id, { add: [input.action.productId] })) });
      case "REMOVE_FROM_SHORTLIST":
        return Response.json({ type: input.action.type, ...(await updateShortlist(context, session.id, { remove: [input.action.productId] })) });
      case "ADD_TO_CART": {
        const product = await getProduct(context, session, input.action.productId);
        if (!product) return Response.json({ error: "That product is no longer available." }, { status: 404 });
        const variantId = input.action.variantId || (("variants" in product && Array.isArray(product.variants) ? product.variants[0]?.id : undefined) || product.id);
        const current = await getCart(context, session);
        const existing = current.lines.find((line) => line.variantId === variantId);
        const lines = current.lines.map((line) => ({ variantId: line.variantId, quantity: line.variantId === variantId ? line.quantity + 1 : line.quantity }));
        if (!existing) lines.push({ variantId, quantity: 1 });
        return Response.json({ type: input.action.type, cart: await updateCart(context, session, lines) });
      }
      case "OPEN_CART": return Response.json({ type: input.action.type, cart: await getCart(context, session) });
      case "ACCEPT_OFFER": {
        const offer = await getRuntimeStore().get<OfferPayload>(context, runtimeKinds.offer, input.action.offerId) as RuntimeRecord<OfferPayload> | null;
        if (!offer || offer.payload.sessionId !== session.id) throw new Error("That offer is not available for this shopper session.");
        return Response.json({ type: input.action.type, offer: await acceptOffer(context, input.action.offerId) });
      }
      case "CHECKOUT": return Response.json({ type: input.action.type, checkout: await createCheckout(context, { sessionId: session.id, idempotencyKey: `ui-${session.id}-${context.correlationId}` }) });
      case "COMPARE_PRODUCTS": { const products = (await Promise.all(input.action.productIds.map((id) => getProduct(context, session, id)))).filter(Boolean); return Response.json({ type: input.action.type, products, matrix: buildComparisonMatrix(products) }); }
    }
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Storefront action was rejected." }, { status: 400 }); }
}
