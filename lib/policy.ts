export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number | null;
  stock: number;
  finish: string;
  material: string;
  width: number;
  description: string;
  art: string;
  tag?: string;
};

export type PolicyDecision = {
  outcome: "ALLOW" | "COUNTER" | "ESCALATE" | "DENY";
  proposedPrice?: number;
  maxAllowedDiscount?: number;
  matchedRules: string[];
  explanation: string[];
  requiresApproval: boolean;
  riskFlags: string[];
  policyVersion: number;
};

export type CommerceActionInput = {
  product: Product;
  requestedDiscount: number;
  quantity: number;
  customerSegment: "new" | "repeat";
  orderValue?: number;
  isAttack?: boolean;
};

export type CommercePolicy = {
  version: number;
  standardMaxDiscount: number;
  repeatMaxDiscount: number;
  minimumMargin: number;
  lowStockThreshold: number;
  approvalThreshold: number;
};

export const demoPolicy: CommercePolicy = {
  version: 18,
  standardMaxDiscount: 10,
  repeatMaxDiscount: 15,
  minimumMargin: 25,
  lowStockThreshold: 10,
  approvalThreshold: 50000,
};

export function evaluateCommerceAction(input: CommerceActionInput, policy: CommercePolicy = demoPolicy): PolicyDecision {
  const invalidDecision = (reason: string): PolicyDecision => ({
    outcome: "DENY",
    matchedRules: ["Input validation · malformed commerce request"],
    explanation: [reason],
    requiresApproval: false,
    riskFlags: ["invalid-input"],
    policyVersion: policy.version,
  });

  if (!input || typeof input !== "object" || !input.product || typeof input.product !== "object") {
    return invalidDecision("The policy runtime rejected a malformed commerce request.");
  }

  const { product, requestedDiscount, quantity, customerSegment } = input;
  const numericInputs = [product.price, product.stock, requestedDiscount, quantity];
  const hasInvalidNumericInput = numericInputs.some((value) => typeof value !== "number" || !Number.isFinite(value));
  const hasInvalidCost = product.cost !== null && (typeof product.cost !== "number" || !Number.isFinite(product.cost));

  if (hasInvalidNumericInput || hasInvalidCost || customerSegment !== "new" && customerSegment !== "repeat") {
    return invalidDecision("The policy runtime rejected non-finite or malformed commerce data.");
  }

  if (product.price <= 0 || product.stock < 0 || product.cost != null && product.cost < 0 || requestedDiscount < 0 || requestedDiscount > 100 || quantity <= 0 || !Number.isInteger(quantity)) {
    return invalidDecision("The policy runtime rejected an invalid price, stock, discount, cost, or quantity.");
  }

  // The client-supplied orderValue is display context only. Authority uses canonical product economics.
  const orderValue = product.price * quantity * (1 - requestedDiscount / 100);
  const rules: string[] = [];
  const explanation: string[] = [];
  const riskFlags: string[] = [];
  void riskFlags;
  const isHardAttack = input.isAttack || requestedDiscount >= 80;
  const customerMax = customerSegment === "repeat" ? policy.repeatMaxDiscount : policy.standardMaxDiscount;
  const maxDiscount = Math.min(customerMax, product.tag === "High stock" ? customerMax : customerMax);
  const counterPrice = product.price * (1 - maxDiscount / 100);
  const requestedPrice = product.price * (1 - requestedDiscount / 100);
  const marginAtRequested = product.cost == null ? null : ((requestedPrice - product.cost) / requestedPrice) * 100;
  const marginAtMax = product.cost == null ? null : ((counterPrice - product.cost) / counterPrice) * 100;

  if (isHardAttack) {
    return {
      outcome: "DENY",
      maxAllowedDiscount: maxDiscount,
      matchedRules: ["Hard constraint · maximum discount", "Untrusted proposal boundary"],
      explanation: [
        `LLM proposal: ${requestedDiscount}% discount.`,
        `Policy runtime capped this customer at ${maxDiscount}%.`,
        "No connector action was made.",
      ],
      requiresApproval: false,
      riskFlags: ["prompt-injection", "discount-limit-exceeded"],
      policyVersion: policy.version,
    };
  }

  if (product.tag === "No discount") {
    return {
      outcome: "DENY",
      maxAllowedDiscount: 0,
      matchedRules: ["Brand restriction · Aster", "Hard constraint"],
      explanation: ["This product is protected by a hard no-discount rule."],
      requiresApproval: false,
      riskFlags: ["protected-product"],
      policyVersion: policy.version,
    };
  }

  if (requestedDiscount > 0 && product.stock < policy.lowStockThreshold) {
    return {
      outcome: "DENY",
      maxAllowedDiscount: 0,
      matchedRules: ["Inventory safety · low stock", "Disable negotiation"],
      explanation: [`Only ${product.stock} units remain. Autonomous discounting is disabled below ${policy.lowStockThreshold} units.`],
      requiresApproval: false,
      riskFlags: ["low-stock"],
      policyVersion: policy.version,
    };
  }

  if (product.cost == null) {
    return {
      outcome: "ESCALATE",
      maxAllowedDiscount: maxDiscount,
      matchedRules: ["Missing cost data", "Fail safe · human approval"],
      explanation: ["Cost data is missing, so the runtime cannot prove the margin floor. Autonomous discounting is unavailable."],
      requiresApproval: true,
      riskFlags: ["missing-cost"],
      policyVersion: policy.version,
    };
  }

  rules.push(customerSegment === "repeat" ? `Repeat customer · maximum ${policy.repeatMaxDiscount}%` : `Standard customer · maximum ${policy.standardMaxDiscount}%`);
  rules.push(`Minimum gross margin · ${policy.minimumMargin}%`);
  explanation.push(customerSegment === "repeat" ? `Repeat customer → maximum ${policy.repeatMaxDiscount}%.` : `Standard customer → maximum ${policy.standardMaxDiscount}%.`);
  explanation.push(`Stock → ${product.stock}, threshold = ${policy.lowStockThreshold}.`);
  explanation.push(`Projected margin → ${marginAtRequested?.toFixed(1)}%, required = ${policy.minimumMargin}%.`);

  if (marginAtRequested != null && marginAtRequested < policy.minimumMargin) {
    return {
      outcome: "ESCALATE",
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, "Margin floor · approval required"],
      explanation: [...explanation, "The requested price would breach the merchant's margin floor."],
      requiresApproval: true,
      riskFlags: ["margin-floor"],
      policyVersion: policy.version,
    };
  }

  if (requestedDiscount <= maxDiscount) {
    const requiresApproval = orderValue > policy.approvalThreshold;
    return {
      outcome: requiresApproval ? "ESCALATE" : "ALLOW",
      proposedPrice: requestedPrice,
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, requiresApproval ? "Order threshold · merchant approval" : "Autonomous authority"],
      explanation: [...explanation, `Order value → ${orderValue > policy.approvalThreshold ? "above" : "below"} ₹${policy.approvalThreshold.toLocaleString("en-IN")} approval threshold.`],
      requiresApproval,
      riskFlags: requiresApproval ? ["high-order-value"] : [],
      policyVersion: policy.version,
    };
  }

  if (marginAtMax != null && marginAtMax < policy.minimumMargin) {
    return {
      outcome: "ESCALATE",
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, "Margin floor · approval required"],
      explanation: [...explanation, `Even the policy maximum would project ${marginAtMax.toFixed(1)}% margin. Sending to a merchant.`],
      requiresApproval: true,
      riskFlags: ["margin-floor"],
      policyVersion: policy.version,
    };
  }

  const isBulk = quantity > 1 || orderValue > policy.approvalThreshold;
  return {
    outcome: isBulk ? "ESCALATE" : "COUNTER",
    proposedPrice: counterPrice,
    maxAllowedDiscount: maxDiscount,
    matchedRules: [...rules, isBulk ? "Quantity / order threshold · merchant approval" : "Counter offer · policy maximum"],
    explanation: [
      ...explanation,
      `The strongest safe price is ₹${Math.round(counterPrice).toLocaleString("en-IN")} per unit.`,
      isBulk ? "This request is outside autonomous authority and can be reviewed once by a merchant." : "The runtime returned the policy maximum instead of accepting the requested price.",
    ],
    requiresApproval: isBulk,
    riskFlags: isBulk ? ["outside-autonomous-authority"] : [],
    policyVersion: policy.version,
  };
}
