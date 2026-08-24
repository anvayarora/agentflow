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
