import { z } from "zod";

export const policyVersionStatuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const policySources = ["nim", "demo-fallback", "merchant", "system"] as const;

export const conditionFields = [
  "customer.segment",
  "cart.totalPaise",
  "cart.quantity",
  "product.sku",
  "product.category",
  "product.brand",
  "product.stock",
  "product.costPaise",
  "product.listPricePaise",
  "product.tags",
] as const;

export const conditionOperators = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "in",
  "notIn",
  "includes",
] as const;

const conditionValue = z.union([
  z.string(),
  z.number().int(),
  z.boolean(),
  z.array(z.union([z.string(), z.number().int(), z.boolean()])),
]);

export const policyConditionSchema = z.object({
  field: z.enum(conditionFields),
  operator: z.enum(conditionOperators),
  value: conditionValue,
}).strict();

export const policyScopeSchema = z.object({
  skuIds: z.array(z.string().min(1)).optional(),
  categories: z.array(z.string().min(1)).optional(),
  brands: z.array(z.string().min(1)).optional(),
  customerSegments: z.array(z.enum(["new", "repeat"])).optional(),
  tags: z.array(z.string().min(1)).optional(),
}).strict();

const bps = z.number().int().min(0).max(10_000);

export const policyEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SET_MAX_DISCOUNT_BPS"), valueBps: bps }).strict(),
  z.object({ type: z.literal("ADD_MAX_DISCOUNT_BPS"), valueBps: z.number().int().min(-10_000).max(10_000) }).strict(),
  z.object({ type: z.literal("SET_MIN_MARGIN_BPS"), valueBps: bps }).strict(),
  z.object({ type: z.literal("REQUIRE_APPROVAL") }).strict(),
  z.object({ type: z.literal("DENY") }).strict(),
  z.object({ type: z.literal("ALLOW_BUNDLE") }).strict(),
  z.object({ type: z.literal("SET_QUANTITY_DISCOUNT"), quantity: z.number().int().positive(), discountBps: bps }).strict(),
  z.object({ type: z.literal("DISABLE_NEGOTIATION") }).strict(),
]);

export const policyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().min(0).max(1_000_000),
  hardConstraint: z.boolean(),
  scope: policyScopeSchema,
  conditions: z.array(policyConditionSchema),
  effect: policyEffectSchema,
}).strict();

export const policyVersionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  policyId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(policyVersionStatuses),
  currency: z.string().length(3),
  sourcePrompt: z.string().nullable().optional(),
  source: z.enum(policySources),
  rules: z.array(policyRuleSchema).min(1),
}).strict();

export type PolicyVersionStatus = (typeof policyVersionStatuses)[number];
export type PolicySource = (typeof policySources)[number];
export type ConditionField = (typeof conditionFields)[number];
export type ConditionOperator = (typeof conditionOperators)[number];
export type PolicyCondition = z.infer<typeof policyConditionSchema>;
export type PolicyScope = z.infer<typeof policyScopeSchema>;
export type PolicyEffect = z.infer<typeof policyEffectSchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyVersionIR = z.infer<typeof policyVersionSchema>;
