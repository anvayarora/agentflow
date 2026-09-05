import { z } from "zod";
import { getShopifyUcpClient, toPublicShopifyProduct } from "../../../../../lib/server/shopify/ucp";
import { shopifyPublicError } from "../../../../../lib/server/shopify/public-error";

export const runtime = "nodejs";

const inputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("search"), query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(2048).optional() }).strict(),
  z.object({ operation: z.literal("lookup"), ids: z.array(z.string().min(1).max(255)).min(1).max(10) }).strict(),
  z.object({ operation: z.literal("get"), id: z.string().min(1).max(255) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const client = getShopifyUcpClient();
    if (input.operation === "search") {
      const result = await client.searchCatalog(input.query, { limit: input.limit, cursor: input.cursor });
      return Response.json({ source: "SHOPIFY_UCP_CONNECTED", products: result.products.filter((product): product is NonNullable<typeof product> => Boolean(product)).map(toPublicShopifyProduct), pagination: result.pagination, ucp: result.ucp });
    }
    if (input.operation === "lookup") {
      const result = await client.lookupCatalog(input.ids);
      return Response.json({ source: "SHOPIFY_UCP_CONNECTED", products: result.products.filter((product): product is NonNullable<typeof product> => Boolean(product)).map(toPublicShopifyProduct), ucp: result.ucp });
    }
    const result = await client.getProduct(input.id);
    return Response.json({ source: "SHOPIFY_UCP_CONNECTED", product: result.product ? toPublicShopifyProduct(result.product) : null, ucp: result.ucp });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Shopify UCP catalogue request is invalid.", issues: error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
    return Response.json(shopifyPublicError(error, "The product catalogue is temporarily unavailable."), { status: 502 });
  }
}
