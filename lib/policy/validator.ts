import {
  policyVersionSchema,
  type ConditionField,
  type ConditionOperator,
  type PolicyCondition,
  type PolicyEffect,
  type PolicyRule,
  type PolicyVersionIR,
} from "./schema";

export type DiscrepancySeverity = "high" | "medium" | "low";

export type PolicyDiscrepancy = {
  id: string;
  type: "CONFLICT" | "AMBIGUITY" | "UNSAFE_ASSUMPTION" | "INVALID_POLICY";
  severity: DiscrepancySeverity;
  title: string;
  message: string;
  detail: string;
  relatedRuleIds: string[];
  possibleResolutions: Array<{ id: string; label: string; value?: string | number }>;
  recommendation: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type PolicyValidationResult = {
  valid: boolean;
  policy: PolicyVersionIR | null;
  errors: string[];
  discrepancies: PolicyDiscrepancy[];
};

const numericFields = new Set<ConditionField>([
  "cart.totalPaise",
  "cart.quantity",
  "product.stock",
  "product.costPaise",
  "product.listPricePaise",
]);

const textFields = new Set<ConditionField>([
  "customer.segment",
  "product.sku",
  "product.category",
  "product.brand",
]);

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const discrepancy = (input: Omit<PolicyDiscrepancy, "resolvedAt" | "resolution">): PolicyDiscrepancy => ({
  ...input,
  resolvedAt: null,
  resolution: null,
});

function validateCondition(condition: PolicyCondition, ruleId: string): string[] {
  const errors: string[] = [];
  const { field, operator, value } = condition;
  const comparisonOperator = ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"] as ConditionOperator[];

  if (comparisonOperator.includes(operator) && (!numericFields.has(field) || typeof value !== "number" || !Number.isSafeInteger(value))) {
    errors.push(`Rule ${ruleId}: ${operator} requires an integer numeric field and value.`);
  }
  if (textFields.has(field) && comparisonOperator.includes(operator)) {
    errors.push(`Rule ${ruleId}: ${field} cannot use ${operator}.`);
  }
  if (["in", "notIn"].includes(operator) && (!isArray(value) || value.length === 0)) {
    errors.push(`Rule ${ruleId}: ${operator} requires a non-empty array.`);
  }
  if (operator === "includes" && (field !== "product.tags" || typeof value !== "string")) {
    errors.push(`Rule ${ruleId}: includes is only supported for a product.tags string.`);
  }
  if (field === "product.tags" && !["includes", "in", "notIn", "equals", "notEquals"].includes(operator)) {
    errors.push(`Rule ${ruleId}: product.tags does not support ${operator}.`);
  }
  if (field === "customer.segment" && operator !== "equals" && operator !== "notEquals" && operator !== "in" && operator !== "notIn") {
    errors.push(`Rule ${ruleId}: customer.segment only supports equality or membership.`);
  }
  if (numericFields.has(field) && ["equals", "notEquals"].includes(operator) && typeof value !== "number") {
    errors.push(`Rule ${ruleId}: ${field} requires a numeric value.`);
  }
  if (textFields.has(field) && ["equals", "notEquals"].includes(operator) && typeof value !== "string") {
    errors.push(`Rule ${ruleId}: ${field} requires a string value.`);
  }
  return errors;
}

function sameTarget(a: PolicyRule, b: PolicyRule) {
  return JSON.stringify({ scope: a.scope, conditions: a.conditions }) === JSON.stringify({ scope: b.scope, conditions: b.conditions });
}

function semanticChecks(policy: PolicyVersionIR): { errors: string[]; discrepancies: PolicyDiscrepancy[] } {
  const errors: string[] = [];
  const discrepancies: PolicyDiscrepancy[] = [];
  const ids = new Set<string>();

  for (const rule of policy.rules) {
    if (ids.has(rule.id)) errors.push(`Duplicate policy rule id: ${rule.id}.`);
    ids.add(rule.id);
    if (rule.scope.skuIds?.length === 0 || rule.scope.categories?.length === 0 || rule.scope.brands?.length === 0 || rule.scope.customerSegments?.length === 0 || rule.scope.tags?.length === 0) {
      errors.push(`Rule ${rule.id}: scope arrays must not be empty.`);
    }
    for (const condition of rule.conditions) errors.push(...validateCondition(condition, rule.id));
    if (rule.effect.type === "DENY" && !rule.hardConstraint) errors.push(`Rule ${rule.id}: DENY rules must be hard constraints.`);
    if (rule.effect.type === "DISABLE_NEGOTIATION" && !rule.hardConstraint) errors.push(`Rule ${rule.id}: DISABLE_NEGOTIATION rules must be hard constraints.`);
    if (rule.effect.type === "ADD_MAX_DISCOUNT_BPS" && rule.effect.valueBps < 0 && !rule.hardConstraint) {
      errors.push(`Rule ${rule.id}: a negative soft discount adjustment is not permitted.`);
    }
  }

  for (let left = 0; left < policy.rules.length; left += 1) {
    for (let right = left + 1; right < policy.rules.length; right += 1) {
      const a = policy.rules[left];
      const b = policy.rules[right];
      if (!sameTarget(a, b) || a.effect.type !== "SET_MAX_DISCOUNT_BPS" || b.effect.type !== "SET_MAX_DISCOUNT_BPS") continue;
      if (a.effect.valueBps === b.effect.valueBps) continue;
      discrepancies.push(discrepancy({
        id: `overlapping-max-${a.id}-${b.id}`,
        type: "CONFLICT",
        severity: a.hardConstraint || b.hardConstraint ? "high" : "medium",
        title: "Overlapping discount ceilings",
        message: "Two rules target the same context with different maximum discounts.",
        detail: `${a.name} allows ${a.effect.valueBps / 100}% while ${b.name} allows ${b.effect.valueBps / 100}%. The more restrictive ceiling is safe, but the merchant should make precedence explicit before publishing.`,
        relatedRuleIds: [a.id, b.id],
        possibleResolutions: [
          { id: "keep-restrictive", label: "Keep the stricter ceiling", value: Math.min(a.effect.valueBps, b.effect.valueBps) },
          { id: "keep-permissive", label: "Use the higher ceiling", value: Math.max(a.effect.valueBps, b.effect.valueBps) },
        ],
        recommendation: "Keep the stricter ceiling unless the merchant explicitly approves the higher value.",
      }));
    }
  }

  const hasMarginRule = policy.rules.some((rule) => rule.effect.type === "SET_MIN_MARGIN_BPS");
  if (!hasMarginRule) {
    discrepancies.push(discrepancy({
      id: "missing-margin-floor",
      type: "UNSAFE_ASSUMPTION",
      severity: "high",
      title: "No minimum margin floor",
      message: "The policy has no explicit margin protection.",
      detail: "Commerce actions cannot prove economic safety without a merchant-defined minimum margin.",
      relatedRuleIds: [],
      possibleResolutions: [{ id: "add-margin-floor", label: "Add a 25% floor", value: 2500 }],
      recommendation: "Add a minimum gross margin rule before publishing.",
    }));
  }
  const vipMatch = policy.sourcePrompt?.match(/VIP.{0,50}?([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i);
  const repeatRule = policy.rules.find((rule) => rule.id === "repeat-customer-ceiling" && rule.effect.type === "SET_MAX_DISCOUNT_BPS");
  if (vipMatch && repeatRule?.effect.type === "SET_MAX_DISCOUNT_BPS" && !policy.sourcePrompt?.includes("[VIP_RESOLUTION:trusted-repeat-ceiling]") && Number(vipMatch[1]) * 100 > repeatRule.effect.valueBps) {
    discrepancies.push(discrepancy({
      id: "vip-precedence",
      type: "AMBIGUITY",
      severity: "high",
      title: "VIP authority needs an explicit ceiling",
      message: "The prompt describes a VIP discount above the repeat-customer ceiling, but VIP is not a trusted customer segment in this MVP.",
      detail: `The prompt asks for ${vipMatch[1]}% for VIP customers while repeat customers are capped at ${repeatRule.effect.valueBps / 100}%. No executable VIP rule was created.`,
      relatedRuleIds: [repeatRule.id],
      possibleResolutions: [{ id: "use-repeat-ceiling", label: `Use the repeat ceiling (${repeatRule.effect.valueBps / 100}%)`, value: repeatRule.effect.valueBps }, { id: "use-vip-ceiling", label: `Use the proposed VIP ceiling (${vipMatch[1]}%)`, value: Math.round(Number(vipMatch[1]) * 100) }],
      recommendation: "Choose a trusted segment definition and a ceiling before publishing.",
    }));
  }
  return { errors, discrepancies };
}

export function validatePolicy(value: unknown): PolicyValidationResult {
  const parsed = policyVersionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      policy: null,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`),
      discrepancies: [],
    };
  }
  const checked = semanticChecks(parsed.data);
  return {
    valid: checked.errors.length === 0 && checked.discrepancies.length === 0,
    policy: parsed.data,
    errors: checked.errors,
    discrepancies: checked.discrepancies,
  };
}

export function resolvePolicyDiscrepancy(policy: PolicyVersionIR, discrepancyId: string, resolution: string | number | { valueBps?: number; ruleId?: string }) {
  const next = structuredClone(policy);
  const resolvedValue = typeof resolution === "object" ? resolution.valueBps : typeof resolution === "number" ? resolution : undefined;
  const targetRuleId = typeof resolution === "object" ? resolution.ruleId : undefined;
  const parts = discrepancyId.split("-");
  const relatedRuleIds = discrepancyId.startsWith("overlapping-max-") ? parts.slice(2) : [];
  const target = targetRuleId || (discrepancyId === "vip-precedence" ? "repeat-customer-ceiling" : relatedRuleIds[0]);

  if (resolvedValue !== undefined && target) {
    const rule = next.rules.find((item) => item.id === target);
    if (rule && rule.effect.type === "SET_MAX_DISCOUNT_BPS") rule.effect.valueBps = Math.max(0, Math.min(10_000, Math.round(resolvedValue)));
  }

  if (discrepancyId === "missing-margin-floor" && resolvedValue !== undefined) {
    next.rules.push({
      id: "margin-floor",
      name: "Minimum gross margin",
      description: "Protect the merchant-defined gross margin floor.",
      priority: 700,
      hardConstraint: true,
      scope: {},
      conditions: [],
      effect: { type: "SET_MIN_MARGIN_BPS", valueBps: Math.max(0, Math.min(10_000, Math.round(resolvedValue))) },
    });
  }

  if (discrepancyId === "vip-precedence") next.sourcePrompt = `${next.sourcePrompt || ""}\n[VIP_RESOLUTION:trusted-repeat-ceiling]`;

  const result = validatePolicy(next);
  return { ...result, policy: next };
}

export function isPolicyVersion(value: unknown): value is PolicyVersionIR {
  return policyVersionSchema.safeParse(value).success;
}

export const effectHasType = (effect: PolicyEffect, type: PolicyEffect["type"]) => effect.type === type;
