import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { demoOrganizationId, type TrustedRequestContext } from "../../../../lib/server/context";
import { normalizeShopDomain, configuredShopDomain } from "../../../../lib/server/shopify/ucp";
import { persistShopifyAdminAccessToken } from "../../../../lib/server/shopify/integration";

export const runtime = "nodejs";

const clientId = () => {
  const configured = typeof process === "undefined" ? undefined : process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID;
  if (configured) return configured;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return "";
  return "19d42795913d92ee245ec090b27d7ebd";
};
const publicUrl = () => ((typeof process === "undefined" ? undefined : process.env.AGENTFLOW_PUBLIC_URL) || "https://agentflow-beige-eight.vercel.app").replace(/\/$/, "");
const scopes = ["read_products", "write_products"];

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const item = cookie.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function context(request: Request): TrustedRequestContext {
  const organizationId = (typeof process === "undefined" ? undefined : process.env.AGENTFLOW_MERCHANT_ORGANIZATION_ID) || demoOrganizationId();
  if (!organizationId) throw new Error("A configured AgentFlow organization is required for Shopify OAuth.");
  return { organizationId, actorType: "system", actorId: "shopify-oauth", correlationId: request.headers.get("x-correlation-id") || crypto.randomUUID() };
}

function validHmac(url: URL, secret: string) {
  const provided = url.searchParams.get("hmac") || "";
  const message = [...url.searchParams.entries()].filter(([key]) => key !== "hmac" && key !== "signature").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

function reject(message: string, status = 400) { return Response.json({ error: message }, { status }); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const isCallback = path.endsWith("/callback");
  const shopParam = url.searchParams.get("shop");
  if (!shopParam) return reject("shop is required");
  let shop: string;
  try { shop = normalizeShopDomain(shopParam); } catch { return reject("A valid Shopify development shop is required."); }
  if (shop !== configuredShopDomain()) return reject("This app is restricted to the configured development shop.", 403);
  const secret = typeof process === "undefined" ? undefined : process.env.SHOPIFY_API_SECRET;
  if (!secret) return reject("SHOPIFY_API_SECRET is not configured.", 424);
  if (!clientId()) return reject("SHOPIFY_API_KEY is not configured.", 424);
  const redirectUri = `${publicUrl()}/api/shopify/auth/callback`;

  if (!isCallback) {
    const state = randomBytes(32).toString("hex");
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set("client_id", clientId());
    authorize.searchParams.set("scope", scopes.join(","));
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    const response = new Response(null, { status: 302, headers: { location: authorize.toString() } });
    response.headers.set("set-cookie", `agentflow_shopify_oauth_state=${encodeURIComponent(state)}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return response;
  }

  const state = url.searchParams.get("state");
  const expectedState = cookieValue(request, "agentflow_shopify_oauth_state");
  if (!state || !expectedState || state !== expectedState) return reject("Shopify OAuth state validation failed.", 403);
  if (!validHmac(url, secret)) return reject("Shopify OAuth signature validation failed.", 403);
  const code = url.searchParams.get("code");
  if (!code) return reject("Shopify authorization code is missing.");

  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId(), client_secret: secret, code }),
  });
  const payload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; scope?: string; error?: string };
  if (!tokenResponse.ok || !payload.access_token) return reject("Shopify did not issue an offline Admin access token.", 502);
  const grantedScopes = (payload.scope || "").split(",").map((scope) => scope.trim()).filter(Boolean);
  if (!grantedScopes.includes("write_products")) return reject("Shopify did not grant write_products.", 403);
  await persistShopifyAdminAccessToken(context(request), shop, payload.access_token, grantedScopes);
  const response = new Response(null, { status: 302, headers: { location: `${publicUrl()}/merchant/connectors?shopify=connected` } });
  response.headers.set("set-cookie", "agentflow_shopify_oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  return response;
}
