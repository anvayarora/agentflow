import type { AuditEventInput } from "../domain/audit";
import { MerchantAuthError, type MerchantRole } from "./auth";

export const demoOrganizationId = () => {
  const configured = typeof process === "undefined" ? undefined : process.env.AGENTFLOW_DEMO_ORGANIZATION_ID;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return configured || "";
  return configured || "org_haven_home_demo";
};

export type TrustedRequestContext = {
  organizationId: string;
  actorType: AuditEventInput["actorType"];
  actorId: string;
  correlationId: string;
  role?: MerchantRole;
  authenticated?: boolean;
};

/**
 * Merchant operations are only available to a server-resolved merchant actor.
 * Demo mode intentionally resolves `demo-merchant`; storefront identities are
 * prefixed and can never cross this boundary.
 */
export function assertMerchantContext(context: TrustedRequestContext) {
  if (context.actorType === "customer" || context.actorType === "agent" || /^(shopify:|customer:|shopper:|storefront:)/i.test(context.actorId)) {
    throw new Error("Only an authenticated merchant can perform this operation.");
  }
  if (process.env.NODE_ENV === "production" && context.authenticated !== true) throw new MerchantAuthError("Merchant authentication is required.", 401, "MERCHANT_UNAUTHENTICATED");
  return context;
}

export function getTrustedRequestContext(request?: Request): TrustedRequestContext {
  const headers = request?.headers;
  const correlationId = headers?.get("x-correlation-id") || crypto.randomUUID();
  // The actor header is a local test convenience only. It is ignored in production.
  const actorId = process.env.NODE_ENV === "production" ? "anonymous" : headers?.get("x-agentflow-actor-id") || "demo-merchant";
  if (request && process.env.NODE_ENV === "production") {
    // Synchronous callers receive an unauthenticated context; protected routes
    // use requireMerchantContext() for the async server-side membership lookup.
    return { organizationId: demoOrganizationId(), actorType: "system", actorId, authenticated: false, correlationId };
  }
  return {
    organizationId: demoOrganizationId(),
    actorType: actorId === "demo-merchant" ? "system" : "merchant",
    actorId,
    authenticated: !request || actorId !== "demo-merchant",
    correlationId,
  };
}

/** Async production-safe merchant resolution for HTTP handlers. */
export async function getAuthenticatedMerchantContext(request: Request, requiredRole?: MerchantRole) {
  const { requireMerchantContext } = await import("./auth");
  return requireMerchantContext(request, requiredRole);
}
