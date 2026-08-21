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

export const demoPolicy = {
  version: 18,
  standardMaxDiscount: 10,
  repeatMaxDiscount: 15,
  minimumMargin: 25,
  lowStockThreshold: 10,
  approvalThreshold: 50000,
};

export function evaluateCommerceAction(input: CommerceActionInput): PolicyDecision {
  const { product, requestedDiscount, quantity, customerSegment } = input;
  const orderValue = input.orderValue ?? product.price * quantity * (1 - requestedDiscount / 100);
  const rules: string[] = [];
  const explanation: string[] = [];
  const riskFlags: string[] = [];
  void riskFlags;
  const isHardAttack = input.isAttack || requestedDiscount >= 80;
  const customerMax = customerSegment === "repeat" ? demoPolicy.repeatMaxDiscount : demoPolicy.standardMaxDiscount;
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
        "No Razorpay call was made.",
      ],
      requiresApproval: false,
      riskFlags: ["prompt-injection", "discount-limit-exceeded"],
      policyVersion: demoPolicy.version,
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
      policyVersion: demoPolicy.version,
    };
  }

  if (requestedDiscount > 0 && product.stock < demoPolicy.lowStockThreshold) {
    return {
      outcome: "DENY",
      maxAllowedDiscount: 0,
      matchedRules: ["Inventory safety · low stock", "Disable negotiation"],
      explanation: [`Only ${product.stock} units remain. Autonomous discounting is disabled below ${demoPolicy.lowStockThreshold} units.`],
      requiresApproval: false,
      riskFlags: ["low-stock"],
      policyVersion: demoPolicy.version,
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
      policyVersion: demoPolicy.version,
    };
  }

  rules.push(customerSegment === "repeat" ? "Repeat customer · maximum 15%" : "Standard customer · maximum 10%");
  rules.push(`Minimum gross margin · ${demoPolicy.minimumMargin}%`);
  explanation.push(customerSegment === "repeat" ? "Repeat customer → maximum 15%." : "Standard customer → maximum 10%.");
  explanation.push(`Stock → ${product.stock}, threshold = ${demoPolicy.lowStockThreshold}.`);
  explanation.push(`Projected margin → ${marginAtRequested?.toFixed(1)}%, required = ${demoPolicy.minimumMargin}%.`);

  if (marginAtRequested != null && marginAtRequested < demoPolicy.minimumMargin) {
    return {
      outcome: "ESCALATE",
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, "Margin floor · approval required"],
      explanation: [...explanation, "The requested price would breach the merchant's margin floor."],
      requiresApproval: true,
      riskFlags: ["margin-floor"],
      policyVersion: demoPolicy.version,
    };
  }

  if (requestedDiscount <= maxDiscount) {
    const requiresApproval = orderValue > demoPolicy.approvalThreshold;
    return {
      outcome: requiresApproval ? "ESCALATE" : "ALLOW",
      proposedPrice: requestedPrice,
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, requiresApproval ? "Order threshold · merchant approval" : "Autonomous authority"],
      explanation: [...explanation, `Order value → ${orderValue > demoPolicy.approvalThreshold ? "above" : "below"} ₹50,000 approval threshold.`],
      requiresApproval,
      riskFlags: requiresApproval ? ["high-order-value"] : [],
      policyVersion: demoPolicy.version,
    };
  }

  if (marginAtMax != null && marginAtMax < demoPolicy.minimumMargin) {
    return {
      outcome: "ESCALATE",
      maxAllowedDiscount: maxDiscount,
      matchedRules: [...rules, "Margin floor · approval required"],
      explanation: [...explanation, `Even the policy maximum would project ${marginAtMax.toFixed(1)}% margin. Sending to a merchant.`],
      requiresApproval: true,
      riskFlags: ["margin-floor"],
      policyVersion: demoPolicy.version,
    };
  }

  const isBulk = quantity > 1 || orderValue > demoPolicy.approvalThreshold;
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
    policyVersion: demoPolicy.version,
  };
}
