import { z } from "zod";
import { getProduct } from "../../../../../lib/commerce/catalog-service";
import { getBoundShopifySession } from "../../../../../lib/server/shopify/proxy-context";
import { getShortlist, updateShortlist } from "../../../../../lib/ai/storefront/shopper-state";

export const runtime = "nodejs";
const updateSchema = z.object({ sessionId: z.string().trim().min(1).max(255).optional(), add: z.array(z.string().trim().min(1).max(255)).max(12).optional(), remove: z.array(z.string().trim().min(1).max(255)).max(12).optional(), replace: z.array(z.string().trim().min(1).max(255)).max(12).optional() }).strict();

export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId") || undefined;
    const { context, session } = await getBoundShopifySession(request, sessionId);
    const shortlist = await getShortlist(context, session.id);
    const products = (await Promise.all(shortlist.productIds.map((productId) => getProduct(context, session, productId)))).filter(Boolean);
    return Response.json({ sessionId: session.id, productIds: shortlist.productIds, products });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Shortlist could not be loaded." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const { context, session } = await getBoundShopifySession(request, input.sessionId);
    const shortlist = await updateShortlist(context, session.id, input);
    const products = (await Promise.all(shortlist.productIds.map((productId) => getProduct(context, session, productId)))).filter(Boolean);
    return Response.json({ sessionId: session.id, productIds: shortlist.productIds, products });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Shortlist could not be updated." }, { status: 400 }); }
}
