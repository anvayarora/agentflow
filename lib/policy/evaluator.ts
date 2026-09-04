import type { CanonicalCustomer, CustomerSegment } from "../domain/customer";
import {
  BASIS_POINTS,
  calculateDiscountBps,
  calculateGrossMarginBps,
  calculateMaximumSafeDiscountBps,
  calculateMinimumAllowedPriceFromMargin,
  calculatePriceAfterDiscount,
  multiplyPaise,
} from "../domain/money";
import type { CanonicalProduct } from "../domain/catalogue";
import { sortRulesForEvaluation } from "./precedence";
import type { PolicyCondition, PolicyRule, PolicyVersionIR } from "./schema";

export type TrustedCommerceSession = {
  id: string;
  organizationId: string;
  currency: string;
  status: string;
  cartTotalPaise: number;
};

export type CommerceEvaluationContext = {
  organizationId: string;
  policy: PolicyVersionIR;
  product: CanonicalProduct;
  customer: CanonicalCustomer;
  session: TrustedCommerceSession;
  request: {
    quantity: number;
    requestedPricePaise?: number;
    requestedDiscountBps?: number;
  };
};

export type CommerceEvaluation = {
  outcome: "ALLOW" | "COUNTER" | "ESCALATE" | "DENY";
  requestedPricePaise: number;
  approvedPricePaise?: number;
  counterPricePaise?: number;
  maxDiscountBps?: number;
  matchedRules: string[];
  evidence: string[];
  requiresApproval: boolean;
  policyVersionId: string;
  policyVersionNumber: number;
  riskFlags: string[];
};

function fieldValue(condition: PolicyCondition, context: CommerceEvaluationContext): unknown {
  const { product, customer, session, request } = context;
  switch (condition.field) {
    case "customer.segment": return deriveSegment(customer);
    // A live session cart already contains canonical line totals. Simulation
    // contexts may provide an empty cart, in which case derive the requested
    // line total once. Never double-count the requested item.
    case "cart.totalPaise": return session.cartTotalPaise > 0 ? session.cartTotalPaise : multiplyPaise(product.listPricePaise, request.quantity);
    case "cart.quantity": return request.quantity;
    case "product.sku": return product.sku;
    case "product.category": return product.category;
    case "product.brand": return product.brand;
    case "product.stock": return product.stock;
    case "product.costPaise": return product.costPaise;
    case "product.listPricePaise": return product.listPricePaise;
    case "product.tags": return product.tags;
  }
}

function compare(condition: PolicyCondition, context: CommerceEvaluationContext) {
  const actual = fieldValue(condition, context);
  const expected = condition.value;
  switch (condition.operator) {
    case "equals": return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    case "notEquals": return Array.isArray(actual) ? !actual.includes(expected) : actual !== expected;
    case "greaterThan": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "greaterThanOrEqual": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lessThan": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lessThanOrEqual": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in": return Array.isArray(expected) && expected.includes(actual as never);
    case "notIn": return Array.isArray(expected) && !expected.includes(actual as never);
    case "includes": return Array.isArray(actual) && actual.includes(expected);
  }
}

function matchesScope(rule: PolicyRule, context: CommerceEvaluationContext) {
  const { product, customer } = context;
  const segment: CustomerSegment = deriveSegment(customer);
  if (rule.scope.skuIds?.length && !rule.scope.skuIds.includes(product.id) && !rule.scope.skuIds.includes(product.sku)) return false;
  if (rule.scope.categories?.length && !rule.scope.categories.includes(product.category)) return false;
  if (rule.scope.brands?.length && (!product.brand || !rule.scope.brands.includes(product.brand))) return false;
  if (rule.scope.customerSegments?.length && !rule.scope.customerSegments.includes(segment)) return false;
  if (rule.scope.tags?.length && !rule.scope.tags.some((tag) => product.tags.includes(tag))) return false;
  return rule.conditions.every((condition) => compare(condition, context));
}

function deriveSegment(customer: CanonicalCustomer): CustomerSegment {
  return customer.orderCount > 0 ? "repeat" : "new";
}

function specificity(rule: PolicyRule) {
  return (rule.scope.skuIds?.length ?? 0) * 4
    + (rule.scope.brands?.length ?? 0) * 3
    + (rule.scope.categories?.length ?? 0) * 2
    + (rule.scope.customerSegments?.length ?? 0)
    + rule.conditions.length;
}

function maxCeiling(rules: PolicyRule[]) {
  const ceilings = rules.filter((rule) => rule.effect.type === "SET_MAX_DISCOUNT_BPS");
  if (!ceilings.length) return BASIS_POINTS;
  const highestSpecificity = Math.max(...ceilings.map(specificity));
  const sameLevel = ceilings.filter((rule) => specificity(rule) === highestSpecificity);
  const selected = Math.min(...sameLevel.map((rule) => rule.effect.type === "SET_MAX_DISCOUNT_BPS" ? rule.effect.valueBps : BASIS_POINTS));
  const hardCeilings = ceilings.filter((rule) => rule.hardConstraint).map((rule) => rule.effect.type === "SET_MAX_DISCOUNT_BPS" ? rule.effect.valueBps : BASIS_POINTS);
  return Math.min(selected, ...(hardCeilings.length ? [Math.min(...hardCeilings)] : []));
}

function evidenceFor(rule: PolicyRule) {
  switch (rule.effect.type) {
    case "SET_MAX_DISCOUNT_BPS": return `${rule.name}: maximum discount ${rule.effect.valueBps / 100}%.`;
    case "ADD_MAX_DISCOUNT_BPS": return `${rule.name}: adds ${rule.effect.valueBps / 100} percentage points before hard caps.`;
    case "SET_MIN_MARGIN_BPS": return `${rule.name}: minimum gross margin ${rule.effect.valueBps / 100}%.`;
    case "REQUIRE_APPROVAL": return `${rule.name}: merchant approval required.`;
    case "DENY": return `${rule.name}: hard denial.`;
    case "ALLOW_BUNDLE": return `${rule.name}: bundle capability allowed.`;
    case "SET_QUANTITY_DISCOUNT": return `${rule.name}: ${rule.effect.discountBps / 100}% at quantity ${rule.effect.quantity}.`;
    case "DISABLE_NEGOTIATION": return `${rule.name}: autonomous negotiation disabled.`;
  }
}

export function evaluateCommerceAction(context: CommerceEvaluationContext): CommerceEvaluation {
  const { product, customer, session, request, policy } = context;
  if (context.organizationId !== policy.organizationId || product.organizationId !== context.organizationId || customer.organizationId !== context.organizationId || session.organizationId !== context.organizationId) {
    throw new Error("Trusted commerce context has inconsistent organization ownership.");
  }
  if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) throw new Error("Quantity must be a positive integer.");
  if (request.quantity > product.stock) {
    return {
      outcome: "DENY",
      requestedPricePaise: product.listPricePaise,
      maxDiscountBps: 0,
      matchedRules: ["inventory-availability"],
      evidence: [`Requested quantity ${request.quantity} exceeds canonical stock ${product.stock}.`],
      requiresApproval: false,
      policyVersionId: policy.id,
      policyVersionNumber: policy.version,
      riskFlags: ["insufficient-stock"],
    };
  }

  const requestedPricePaise = request.requestedPricePaise !== undefined
    ? Math.max(0, Math.min(product.listPricePaise, request.requestedPricePaise))
    : calculatePriceAfterDiscount(product.listPricePaise, request.requestedDiscountBps ?? 0);
  const requestedDiscountBps = request.requestedPricePaise !== undefined
    ? calculateDiscountBps(product.listPricePaise, requestedPricePaise)
    : request.requestedDiscountBps ?? 0;
  const applicableRules = sortRulesForEvaluation(policy.rules.filter((rule) => matchesScope(rule, context)));
  const matchedRules = applicableRules.map((rule) => rule.id);
  const evidence = applicableRules.map(evidenceFor);
  const hardDeny = applicableRules.find((rule) => rule.effect.type === "DENY" && rule.hardConstraint);
  if (hardDeny) {
    return { outcome: "DENY", requestedPricePaise, maxDiscountBps: 0, matchedRules, evidence: [...evidence, "A hard denial overrides every promotional rule."], requiresApproval: false, policyVersionId: policy.id, policyVersionNumber: policy.version, riskFlags: ["hard-deny"] };
  }

  const disableNegotiation = applicableRules.some((rule) => rule.effect.type === "DISABLE_NEGOTIATION");
  const marginRules = applicableRules.filter((rule) => rule.effect.type === "SET_MIN_MARGIN_BPS");
  const minimumMarginBps = marginRules.length ? Math.max(...marginRules.map((rule) => rule.effect.type === "SET_MIN_MARGIN_BPS" ? rule.effect.valueBps : 0)) : null;
  const approvalRequired = applicableRules.some((rule) => rule.effect.type === "REQUIRE_APPROVAL");
  const additions = applicableRules.filter((rule) => rule.effect.type === "ADD_MAX_DISCOUNT_BPS").reduce((sum, rule) => sum + (rule.effect.type === "ADD_MAX_DISCOUNT_BPS" ? rule.effect.valueBps : 0), 0);
  const quantityDiscounts = applicableRules.filter((rule) => rule.effect.type === "SET_QUANTITY_DISCOUNT" && request.quantity >= rule.effect.quantity).map((rule) => rule.effect.type === "SET_QUANTITY_DISCOUNT" ? rule.effect.discountBps : BASIS_POINTS);
  let maxDiscountBps = Math.max(0, Math.min(BASIS_POINTS, maxCeiling(applicableRules) + additions));
  if (quantityDiscounts.length) maxDiscountBps = Math.min(maxDiscountBps, Math.max(...quantityDiscounts));
  const marginFloorImpossible = minimumMarginBps !== null && product.costPaise !== null && calculateMinimumAllowedPriceFromMargin(product.costPaise, minimumMarginBps) > product.listPricePaise;
  if (minimumMarginBps !== null && product.costPaise !== null) {
    maxDiscountBps = Math.min(maxDiscountBps, calculateMaximumSafeDiscountBps(product.listPricePaise, product.costPaise, minimumMarginBps));
  }
  const approvedPricePaise = calculatePriceAfterDiscount(product.listPricePaise, maxDiscountBps);
  const requiresApproval = approvalRequired;
  const costMissing = minimumMarginBps !== null && product.costPaise === null;
  const requestedMarginUnsafe = minimumMarginBps !== null && product.costPaise !== null && requestedPricePaise < calculateMinimumAllowedPriceFromMargin(product.costPaise, minimumMarginBps);
  const common = { requestedPricePaise, maxDiscountBps, matchedRules, evidence, policyVersionId: policy.id, policyVersionNumber: policy.version };

  if (disableNegotiation && requestedDiscountBps > 0) {
    return { ...common, outcome: "DENY", requiresApproval: false, riskFlags: ["negotiation-disabled", "low-stock"] };
  }
  if (costMissing) {
    return { ...common, outcome: "ESCALATE", counterPricePaise: approvedPricePaise, requiresApproval: true, riskFlags: ["missing-cost"] };
  }
  if (marginFloorImpossible || requestedMarginUnsafe) {
    return { ...common, outcome: "ESCALATE", counterPricePaise: approvedPricePaise, requiresApproval: true, riskFlags: ["margin-floor"] };
  }
  if (requestedDiscountBps <= maxDiscountBps && !requiresApproval) {
    const margin = product.costPaise === null ? null : calculateGrossMarginBps(requestedPricePaise, product.costPaise);
    return { ...common, outcome: "ALLOW", approvedPricePaise: requestedPricePaise, requiresApproval: false, evidence: margin === null ? evidence : [...evidence, `Requested price preserves ${(margin / 100).toFixed(2)}% gross margin.`], riskFlags: [] };
  }
  if (requiresApproval) {
    return { ...common, outcome: "ESCALATE", counterPricePaise: approvedPricePaise, requiresApproval: true, riskFlags: ["merchant-approval"] };
  }
  return { ...common, outcome: "COUNTER", counterPricePaise: approvedPricePaise, requiresApproval: false, riskFlags: ["discount-limit-exceeded"] };
}
