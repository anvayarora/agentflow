export const auditEventTypes = [
  "POLICY_DRAFT_CREATED",
  "POLICY_RULE_CHANGED",
  "POLICY_VALIDATED",
  "POLICY_PUBLISHED",
  "COMMERCE_ACTION_REQUESTED",
  "POLICY_EVALUATED",
  "OFFER_ALLOWED",
  "OFFER_COUNTERED",
  "OFFER_ESCALATED",
  "OFFER_DENIED",
  "AGENT_TURN_STARTED",
  "AGENT_TURN_COMPLETED",
  "AGENT_TOOL_REQUESTED",
  "AGENT_TOOL_SUCCEEDED",
  "AGENT_TOOL_REJECTED",
  "PRODUCT_VIEWED",
  "CART_READ",
  "CART_UPDATED",
  "OFFER_REQUESTED",
  "OFFER_ACCEPTED",
  "APPROVAL_REQUESTED",
  "APPROVAL_DECIDED",
  "SCOPED_OVERRIDE_ISSUED",
  "SCOPED_OVERRIDE_CONSUMED",
  "CHECKOUT_CREATED",
  "PAYMENT_CREATED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "TRANSACTION_FAILED",
  "SECURITY_REJECTED",
  "PAYMENT_PROVIDER_ORDER_REQUESTED",
  "CART_HASH_MISMATCH",
  "OVERRIDE_EXPIRED",
  "OVERRIDE_REPLAY_REJECTED",
  "INVALID_PAYMENT_SIGNATURE",
  "UNAUTHORIZED_CHECKOUT_REJECTED",
  "PAYMENT_PROVIDER_VERIFICATION_FAILED",
  "WEBHOOK_RECEIVED",
  "WEBHOOK_DUPLICATE",
] as const;

export type AuditEventType = (typeof auditEventTypes)[number];

export type AuditEventInput = {
  organizationId: string;
  actorType: "merchant" | "customer" | "system" | "agent";
  actorId?: string | null;
  eventType: AuditEventType;
  shoppingSessionId?: string | null;
  policyVersionId?: string | null;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
};
