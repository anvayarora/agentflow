import type { PolicyRule } from "./schema";

export const precedenceCategories = {
  HARD_DENY: 1,
  SKU_BRAND_RESTRICTION: 2,
  INVENTORY_SAFETY: 3,
  MARGIN: 4,
  TRANSACTION_SAFETY: 5,
  APPROVAL: 6,
  CUSTOMER_SEGMENT: 7,
  CATEGORY_PROMOTION: 8,
  GLOBAL: 9,
} as const;

export type PrecedenceCategory = keyof typeof precedenceCategories;

const conditionFields = (rule: PolicyRule) => rule.conditions.map((condition) => condition.field);

export function classifyRule(rule: PolicyRule): PrecedenceCategory {
  if (rule.effect.type === "DENY" && rule.hardConstraint) return "HARD_DENY";
  const fields = conditionFields(rule);
  if (rule.scope.skuIds?.length || rule.scope.brands?.length || fields.includes("product.sku") || fields.includes("product.brand")) return "SKU_BRAND_RESTRICTION";
  if (rule.effect.type === "DISABLE_NEGOTIATION" || fields.includes("product.stock")) return "INVENTORY_SAFETY";
  if (rule.effect.type === "SET_MIN_MARGIN_BPS" || fields.includes("product.costPaise")) return "MARGIN";
  if (fields.includes("cart.totalPaise") || fields.includes("cart.quantity")) {
    return rule.effect.type === "REQUIRE_APPROVAL" ? "APPROVAL" : "TRANSACTION_SAFETY";
  }
  if (rule.effect.type === "REQUIRE_APPROVAL") return "APPROVAL";
  if (rule.scope.customerSegments?.length || fields.includes("customer.segment")) return "CUSTOMER_SEGMENT";
  if (rule.scope.categories?.length || rule.scope.tags?.length || fields.includes("product.category") || rule.effect.type === "ADD_MAX_DISCOUNT_BPS") return "CATEGORY_PROMOTION";
  return "GLOBAL";
}

export function sortRulesForEvaluation(rules: PolicyRule[]) {
  return [...rules].sort((a, b) => {
    const categoryDifference = precedenceCategories[classifyRule(a)] - precedenceCategories[classifyRule(b)];
    if (categoryDifference !== 0) return categoryDifference;
    if (a.hardConstraint !== b.hardConstraint) return a.hardConstraint ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
}
