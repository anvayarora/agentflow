import { z } from "zod";

export const growthSignalTypes = [
  "LOW_VELOCITY",
  "HIGH_STOCK",
  "LOW_STOCK",
  "HIGH_MARGIN",
  "LOW_MARGIN",
  "STRONG_AFFINITY",
  "LOW_ATTACH_RATE",
  "REPEAT_PURCHASE_AFFINITY",
  "HIGH_CART_VALUE",
  "PRODUCT_AGING_SIGNAL",
  "NEGOTIATION_PRESSURE",
  "DISCOUNT_OVERUSE",
] as const;

export type GrowthSignalType = (typeof growthSignalTypes)[number];
export type GrowthSignalSeverity = "info" | "attention" | "critical";

export const growthOpportunityTypes = [
  "BUNDLE",
  "CROSS_SELL",
  "UPSELL",
  "INVENTORY_RECOVERY",
  "PRIVATE_INCENTIVE",
  "QUANTITY_INCENTIVE",
  "SUPPRESS_DISCOUNT",
  "REQUEST_HUMAN_REVIEW",
] as const;

export type GrowthOpportunityType = (typeof growthOpportunityTypes)[number];
export type GrowthOpportunityStatus = "DETECTED" | "REVIEW" | "READY" | "ACTIVE" | "PAUSED" | "DISMISSED" | "ARCHIVED";
export type GrowthPlayStatus = "DRAFT" | "SIMULATED" | "ACTIVE" | "PAUSED" | "DISMISSED";

export const growthSignalSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  type: z.enum(growthSignalTypes),
  productId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  relatedProductId: z.string().nullable().optional(),
  severity: z.enum(["info", "attention", "critical"]),
  confidenceBps: z.number().int().min(0).max(10_000),
  evidence: z.record(z.string(), z.unknown()),
  calculatedAt: z.string(),
}).strict();

export type GrowthSignal = z.infer<typeof growthSignalSchema>;

export const growthOpportunitySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  type: z.enum(growthOpportunityTypes),
  sourceSignalIds: z.array(z.string()),
  primaryProductId: z.string().min(1),
  secondaryProductIds: z.array(z.string()),
  proposedAction: z.record(z.string(), z.unknown()),
  estimatedImpact: z.record(z.string(), z.unknown()),
  evidence: z.record(z.string(), z.unknown()),
  riskFlags: z.array(z.string()),
  policyCompatibility: z.enum(["COMPATIBLE", "REVIEW", "INCOMPATIBLE"]),
  scoreBps: z.number().int().min(0).max(10_000),
  status: z.enum(["DETECTED", "REVIEW", "READY", "ACTIVE", "PAUSED", "DISMISSED", "ARCHIVED"]),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export type GrowthOpportunity = z.infer<typeof growthOpportunitySchema>;

export const growthPlaySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  opportunityId: z.string().min(1),
  primaryProductId: z.string().min(1),
  secondaryProductIds: z.array(z.string()),
  eligibility: z.record(z.string(), z.unknown()),
  commercialStrategy: z.record(z.string(), z.unknown()),
  maxIncentiveBps: z.number().int().min(0).max(10_000),
  minimumMarginBps: z.number().int().min(0).max(10_000),
  requiredPolicyChecks: z.array(z.string()),
  customerEligibility: z.record(z.string(), z.unknown()),
  frequencyLimit: z.record(z.string(), z.unknown()),
  expiresAt: z.string().nullable().optional(),
  approvalRequired: z.boolean(),
  status: z.enum(["DRAFT", "SIMULATED", "ACTIVE", "PAUSED", "DISMISSED"]),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export type GrowthPlay = z.infer<typeof growthPlaySchema>;

export type PrivateEconomicsUpdate = {
  productId: string;
  costPaise?: number | null;
  brand?: string | null;
  category?: string;
  supplier?: string | null;
  privateTags?: string[];
  externalId?: string | null;
};

export type ImportReport = {
  rowsParsed: number;
  rowsMatched: number;
  rowsCreated: number;
  rowsUpdated: number;
  warnings: string[];
  errors: string[];
  updates: PrivateEconomicsUpdate[];
};
