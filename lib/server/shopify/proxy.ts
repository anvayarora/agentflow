import { createHmac, timingSafeEqual } from "node:crypto";
import { configuredShopDomain, normalizeShopDomain } from "./ucp";

export const SHOPIFY_PROXY_REPLAY_WINDOW_SECONDS = 300;

export type VerifiedShopifyProxyRequest = {
  shopDomain: string;
  loggedInCustomerId?: string;
  timestamp: number;
  pathPrefix?: string;
};

export class ShopifyProxyError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_SHOPIFY_PROXY_REQUEST") {
    super(message);
    this.name = "ShopifyProxyError";
    this.code = code;
  }
}

const env = () => (typeof process === "undefined" ? undefined : process.env);

function signedQueryString(url: URL): string {
  const values = new Map<string, string[]>();
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature") continue;
    const existing = values.get(key) || [];
    existing.push(value);
    values.set(key, existing);
  }
  return [...values.entries()]
    .map(([key, entries]) => `${key}=${entries.join(",")}`)
    .sort()
    .join("");
}

export function calculateShopifyProxySignature(url: URL, secret: string): string {
  return createHmac("sha256", secret).update(signedQueryString(url)).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyShopifyProxyRequest(request: Request, options: { nowSeconds?: number; expectedShopDomain?: string; secret?: string } = {}): VerifiedShopifyProxyRequest {
  const url = new URL(request.url);
  const secret = options.secret || env()?.SHOPIFY_API_SECRET;
  if (!secret) throw new ShopifyProxyError("Shopify App Proxy secret is not configured.", "SHOPIFY_PROXY_SECRET_NOT_CONFIGURED");
  const shop = url.searchParams.get("shop");
  const signature = url.searchParams.get("signature");
  const timestampText = url.searchParams.get("timestamp");
  if (!shop || !signature || !timestampText) throw new ShopifyProxyError("Shopify App Proxy signature parameters are incomplete.", "MISSING_PROXY_SIGNATURE_FIELDS");
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(shop);
  } catch {
    throw new ShopifyProxyError("Shopify App Proxy shop domain is invalid.", "INVALID_PROXY_SHOP_DOMAIN");
  }
  const expectedShopDomain = normalizeShopDomain(options.expectedShopDomain || configuredShopDomain());
  if (shopDomain !== expectedShopDomain) throw new ShopifyProxyError("Shopify App Proxy shop domain is not linked to this AgentFlow organization.", "PROXY_SHOP_DOMAIN_MISMATCH");
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) throw new ShopifyProxyError("Shopify App Proxy timestamp is invalid.", "INVALID_PROXY_TIMESTAMP");
  const nowSeconds = options.nowSeconds || Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > SHOPIFY_PROXY_REPLAY_WINDOW_SECONDS) throw new ShopifyProxyError("Shopify App Proxy request is outside the replay window.", "STALE_PROXY_REQUEST");
  const calculated = calculateShopifyProxySignature(url, secret);
  if (!secureEqual(signature, calculated)) throw new ShopifyProxyError("Shopify App Proxy signature is invalid.", "INVALID_PROXY_SIGNATURE");
  const customerId = url.searchParams.get("logged_in_customer_id") || undefined;
  return { shopDomain, loggedInCustomerId: customerId, timestamp, pathPrefix: url.searchParams.get("path_prefix") || undefined };
}
