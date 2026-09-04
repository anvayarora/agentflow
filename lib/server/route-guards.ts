import { MerchantAuthError, requireMerchantContext, type MerchantRole } from "./auth";
import { getShopifyProxyContext } from "./shopify/proxy-context";
import type { TrustedRequestContext } from "./context";

export function production() { return process.env.NODE_ENV === "production"; }
export function demoAllowed() { return process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true"; }

export function authErrorResponse(error: unknown, fallback = "Request is not authorized.") {
  if (error instanceof MerchantAuthError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}

export async function merchantContextOrResponse(request: Request, role?: MerchantRole): Promise<{ context: TrustedRequestContext } | { response: Response }> {
  if (!production()) return { context: (await import("./context")).getTrustedRequestContext(request) };
  try { return { context: await requireMerchantContext(request, role) }; }
  catch (error) { return { response: authErrorResponse(error) }; }
}

/** Direct shopper/demo routes are disabled in production. Shopify App Proxy is the only public shopper boundary. */
export function assertSignedShopperBoundary(request: Request) {
  void request;
  if (!production()) return null;
  return Response.json({ error: "Use the signed Shopify storefront boundary.", code: "SHOPPER_BOUNDARY_REQUIRED" }, { status: 401 });
}

export async function signedShopperContextOrResponse(request: Request) {
  try { return { value: await getShopifyProxyContext(request) }; }
  catch (error) { return { response: error instanceof Error && "code" in error ? Response.json({ error: error.message, code: String((error as { code?: unknown }).code || "INVALID_SHOPIFY_PROXY_REQUEST") }, { status: 401 }) : authErrorResponse(error) }; }
}
