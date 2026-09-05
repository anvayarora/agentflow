import { ShopifyProxyError } from "./proxy";

/** Keep provider, database, and adapter internals out of the shopper UI. */
export function shopifyPublicError(error: unknown, fallback: string) {
  if (error instanceof ShopifyProxyError) return { error: error.message, code: error.code };
  return { error: fallback, code: "SHOPIFY_REQUEST_FAILED" };
}

export function shopifyPublicErrorResponse(error: unknown, fallback: string, status = 400) {
  return Response.json(shopifyPublicError(error, fallback), { status });
}
