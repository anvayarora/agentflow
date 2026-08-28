import type { AuditEventInput } from "../domain/audit";

export const demoOrganizationId = () => (typeof process === "undefined" ? undefined : process.env.AGENTFLOW_DEMO_ORGANIZATION_ID) || "org_haven_home_demo";

export type TrustedRequestContext = {
  organizationId: string;
  actorType: AuditEventInput["actorType"];
  actorId: string;
  correlationId: string;
};

/**
 * Merchant operations are only available to a server-resolved merchant actor.
 * Demo mode intentionally resolves `demo-merchant`; storefront identities are
 * prefixed and can never cross this boundary.
 */
export function assertMerchantContext(context: TrustedRequestContext) {
  if (context.actorType === "customer" || /^(shopify:|customer:|shopper:|storefront:)/i.test(context.actorId)) {
    throw new Error("Only an authenticated merchant can perform this operation.");
  }
  return context;
}

export function getTrustedRequestContext(request?: Request): TrustedRequestContext {
  const headers = request?.headers;
  const correlationId = headers?.get("x-correlation-id") || crypto.randomUUID();
  const actorId = headers?.get("x-agentflow-actor-id") || "demo-merchant";
  return {
    organizationId: demoOrganizationId() || "org_haven_home_demo",
    actorType: actorId === "demo-merchant" ? "system" : "merchant",
    actorId,
    correlationId,
  };
}
