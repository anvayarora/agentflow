import { z } from "zod";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { resolveShopifyIntegration } from "../../../../../lib/server/shopify/integration";
import { verifyShopifyProxyRequest } from "../../../../../lib/server/shopify/proxy";
import { shopifyPublicError } from "../../../../../lib/server/shopify/public-error";
import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";
import { runStorefrontAgent } from "../../../../../lib/ai/storefront/agent";
import { consumeRateLimit, rateLimitResponse } from "../../../../../lib/server/rate-limit";

export const runtime = "nodejs";

const storefrontContextSchema = z.object({
  url: z.string().url().max(2048).optional(),
  pageType: z.enum(["home", "collection", "product", "search", "cart", "other"]).optional(),
  currentProductId: z.string().max(255).optional(),
  currentCollection: z.string().max(120).optional(),
  hintedProductId: z.string().max(255).optional(),
  hintedVariantId: z.string().max(255).optional(),
}).strict();

const requestSchema = z.object({
  sessionId: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(2000),
  storefrontContext: storefrontContextSchema.optional(),
}).strict();

function errorResponse(error: unknown, status = 400) {
  return Response.json(shopifyPublicError(error, "The shopping assistant is temporarily unavailable."), { status });
}

export async function POST(request: Request) {
  let verified: ReturnType<typeof verifyShopifyProxyRequest>;
  try {
    verified = verifyShopifyProxyRequest(request);
  } catch (error) {
    return errorResponse(error, 401);
  }
  try {
    const body = requestSchema.parse(await request.json());
    const baseContext = getTrustedRequestContext(request);
    const integration = await resolveShopifyIntegration(verified.shopDomain, baseContext.organizationId);
    if (!integration) return Response.json({ error: "This Shopify store is not linked to an AgentFlow organization." }, { status: 403 });
    const context = {
      organizationId: integration.organizationId,
      actorType: "customer" as const,
      actorId: verified.loggedInCustomerId ? `shopify:${verified.loggedInCustomerId}` : "shopify:anonymous",
      correlationId: baseContext.correlationId,
    };
    const repository = getCommerceRepository();
    const session = body.sessionId ? await repository.getSession(context, body.sessionId) : await repository.createShopifySession(context, { shopDomain: verified.shopDomain, shopifyCustomerId: verified.loggedInCustomerId });
    if (!session) return Response.json({ error: "Shopify AgentFlow session was not found." }, { status: 404 });
    const limit = await consumeRateLimit("STORE_CHAT", `${context.organizationId}:${session.id}`);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    if (session.shopifyShopDomain && session.shopifyShopDomain !== verified.shopDomain) return Response.json({ error: "Shopify session shop binding is invalid." }, { status: 403 });
    await repository.recordAudit(context, { eventType: "COMMERCE_ACTION_REQUESTED", entityType: "shopify_agent_message", entityId: session.id, shoppingSessionId: session.id, metadata: { source: "shopify_app_proxy", messageLength: body.message.length, pageType: body.storefrontContext?.pageType || "unknown", hasHints: Boolean(body.storefrontContext) } });
    const agent = await runStorefrontAgent({ context, sessionId: session.id, message: body.message, storefrontContext: body.storefrontContext });
    return Response.json({ ...agent, connection: { shopDomain: verified.shopDomain, customerContext: verified.loggedInCustomerId ? "trusted_shopify_customer" : "anonymous_shopify_customer", policyAuthority: "server_only" }, parts: [] }, { status: agent.status === "PROVIDER_UNAVAILABLE" ? 503 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Storefront message payload is invalid.", issues: error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
    return errorResponse(error, 400);
  }
}
