import type { CommercePolicy } from "./policy";

export type PolicyBlockType = "context" | "constraint" | "approval" | "connector" | "outcome";
export type DiscrepancySeverity = "high" | "medium" | "low";

export type PolicyBlock = {
  id: string;
  type: PolicyBlockType;
  title: string;
  detail: string;
  source: string;
  status: "ready" | "needs-review";
};

export type PolicyDiscrepancy = {
  id: string;
  severity: DiscrepancySeverity;
  title: string;
  detail: string;
  recommendation: string;
};

export type CompiledOnboarding = {
  source: "nim" | "demo-fallback";
  model: string;
  workflowName: string;
  summary: string;
  policy: CommercePolicy;
  blocks: PolicyBlock[];
  discrepancies: PolicyDiscrepancy[];
  assumptions: string[];
};

const readPercent = (text: string, pattern: RegExp, fallback: number) => Number(text.match(pattern)?.[1] ?? fallback);

const readMoney = (text: string, pattern: RegExp, fallback: number) => {
  const raw = text.match(pattern)?.[1]?.replaceAll(",", "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function compileDemoOnboarding(prompt: string): CompiledOnboarding {
  const standard = readPercent(prompt, /standard(?:\s+customers?)?.{0,50}?([0-9]{1,2})\s*%/i, 10);
  const repeat = readPercent(prompt, /repeat(?:\s+customers?)?.{0,50}?([0-9]{1,2})\s*%/i, 15);
  const margin = readPercent(prompt, /(?:margin|gross\s+margin).{0,50}?([0-9]{1,2})\s*%/i, 25);
  const lowStock = readPercent(prompt, /low[-\s]?stock.{0,50}?([0-9]{1,3})\s*(?:units?)?/i, 10);
  const approval = readMoney(prompt, /(?:above|over|exceed(?:ing)?).{0,20}?₹?\s*([0-9][0-9,]*)/i, 50000);
  const vip = readPercent(prompt, /VIP.{0,50}?([0-9]{1,2})\s*%/i, 0);
  const discrepancies: PolicyDiscrepancy[] = [];

  if (vip > repeat) {
    discrepancies.push({
      id: "discount-precedence",
      severity: "high",
      title: "VIP authority exceeds the repeat-customer ceiling",
      detail: `The prompt grants VIP customers ${vip}% while repeat customers are capped at ${repeat}%. The runtime needs an explicit precedence rule before this can be published.`,
      recommendation: `Choose whether VIP customers inherit the ${repeat}% repeat ceiling or receive a separate, approved ${vip}% exception.`,
    });
  }

  if (standard > repeat) {
    discrepancies.push({
      id: "segment-order",
      severity: "medium",
      title: "Standard authority is higher than repeat authority",
      detail: `Standard customers are set to ${standard}% while repeat customers are set to ${repeat}%.`,
      recommendation: "Confirm that the segment hierarchy is intentional, or lower the standard ceiling.",
    });
  }

  if (margin < 15) {
    discrepancies.push({
      id: "margin-floor",
      severity: "high",
      title: "Margin floor is unusually low",
      detail: `A ${margin}% margin floor leaves very little room for catalogue or shipping variance.`,
      recommendation: "Confirm the floor with a finance owner before publishing.",
    });
  }

  const policy: CommercePolicy = {
    version: 19,
    standardMaxDiscount: Math.max(0, Math.min(100, standard)),
    repeatMaxDiscount: Math.max(0, Math.min(100, repeat)),
    minimumMargin: Math.max(0, Math.min(100, margin)),
    lowStockThreshold: Math.max(0, Math.round(lowStock)),
    approvalThreshold: Math.max(0, Math.round(approval)),
  };

  return {
    source: "demo-fallback",
    model: "Deterministic policy compiler",
    workflowName: "Haven Home · Everyday commerce",
    summary: "The prompt has been translated into typed blocks. Resolve the highlighted discrepancy before publishing.",
    policy,
    discrepancies,
    assumptions: [
      "The catalogue owns the canonical price, cost, and inventory values.",
      "A connector can provide capability, but it cannot override policy authority.",
      "Missing cost data routes an offer to human review instead of guessing margin.",
    ],
    blocks: [
      { id: "buyer-context", type: "context", title: "Buyer context", detail: `Standard ${policy.standardMaxDiscount}% · repeat ${policy.repeatMaxDiscount}%`, source: "customer.segment", status: "ready" },
      { id: "inventory-guard", type: "constraint", title: "Inventory safety", detail: `No autonomous discount below ${policy.lowStockThreshold} units`, source: "product.inventory", status: "ready" },
      { id: "margin-floor", type: "constraint", title: "Margin floor", detail: `Gross margin must stay above ${policy.minimumMargin}%`, source: "product.economics", status: "ready" },
      { id: "approval-boundary", type: "approval", title: "Human approval", detail: `Escalate orders above ₹${policy.approvalThreshold.toLocaleString("en-IN")}`, source: "order.value", status: "ready" },
      { id: "connector-boundary", type: "connector", title: "Connector boundary", detail: "Execute only after a valid policy decision", source: "connector.action", status: "ready" },
      { id: "safe-outcome", type: "outcome", title: "Safe outcome", detail: "Allow, counter, escalate, or deny with an explanation", source: "policy.runtime", status: discrepancies.length ? "needs-review" : "ready" },
    ],
  };
}

export function isCompiledOnboarding(value: unknown): value is CompiledOnboarding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompiledOnboarding>;
  return typeof candidate.summary === "string" && typeof candidate.workflowName === "string" && Array.isArray(candidate.blocks) && Array.isArray(candidate.discrepancies) && Boolean(candidate.policy);
}
