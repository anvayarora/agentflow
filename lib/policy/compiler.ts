import { paiseFromRupees } from "../domain/money";
import { policyToGraph, type PolicyGraph } from "./graph-projection";
import { validatePolicy, type PolicyDiscrepancy } from "./validator";
import type { PolicyRule, PolicyVersionIR } from "./schema";

export type CompiledPolicyProposal = {
  source: "nim" | "demo-fallback";
  model: string;
  workflowName: string;
  summary: string;
  policy: PolicyVersionIR;
  graph: PolicyGraph;
  discrepancies: PolicyDiscrepancy[];
  assumptions: string[];
  clarificationQuestions: string[];
  valid: boolean;
};

const readPercent = (text: string, pattern: RegExp, fallback: number) => {
  const value = Number(text.match(pattern)?.[1] ?? fallback);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
};

const readMoney = (text: string, pattern: RegExp, fallback: number) => {
  const raw = text.match(pattern)?.[1]?.replaceAll(",", "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
};

const bps = (percentage: number) => Math.round(percentage * 100);

const rule = (input: PolicyRule): PolicyRule => input;

function clarificationQuestions(prompt: string) {
  const questions: string[] = [];
  if (/old inventory|slow[-\s]?moving|ageing|aging/i.test(prompt) && !/(?:days?|weeks?|months?)/i.test(prompt)) questions.push("How many days should an item be considered slow-moving or old inventory?");
  if (/private bundle|bundle offer|bundle/i.test(prompt) && !/public|private/i.test(prompt)) questions.push("Should this offer be private to eligible sessions, or visible on the public storefront?");
  if (/negotiate|haggling|offer requests/i.test(prompt) && !/once|twice|[0-9]+\s*(?:times|requests?)/i.test(prompt)) questions.push("How many offer requests should one shopping session be allowed to make?");
  if (/margin/i.test(prompt) && !/[0-9]+(?:\.[0-9]+)?\s*%/.test(prompt)) questions.push("What minimum gross margin should every authorized offer preserve?");
  return questions.slice(0, 4);
}

export function compilePolicyProposal(prompt: string, options?: {
  organizationId?: string;
  policyId?: string;
  version?: number;
  source?: "nim" | "demo-fallback";
  model?: string;
}) {
  const organizationId = options?.organizationId ?? "org_haven_home_demo";
  const policyId = options?.policyId ?? "policy-haven-home-commerce";
  const standard = readPercent(prompt, /standard(?:\s+customers?)?.{0,50}?([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i, 10);
  const repeat = readPercent(prompt, /repeat(?:\s+customers?)?.{0,50}?([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i, 15);
  const margin = readPercent(prompt, /(?:margin|gross\s+margin).{0,50}?([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i, 25);
  const lowStock = readMoney(prompt, /low[-\s]?stock.{0,50}?([0-9]{1,3})\s*(?:units?)?/i, 10);
  const approval = readMoney(prompt, /(?:above|over|exceed(?:ing)?).{0,20}?₹?\s*([0-9][0-9,]*)/i, 50_000);
  const version = options?.version ?? 1;

  const policy: PolicyVersionIR = {
    id: `policy-version-${policyId}-${version}`,
    organizationId,
    policyId,
    version,
    status: "DRAFT",
    currency: "INR",
    sourcePrompt: prompt,
    source: options?.source ?? "demo-fallback",
    rules: [
      rule({ id: "global-max-discount", name: "Standard customer ceiling", description: "Set the default autonomous discount ceiling.", priority: 100, hardConstraint: false, scope: {}, conditions: [], effect: { type: "SET_MAX_DISCOUNT_BPS", valueBps: bps(standard) } }),
      rule({ id: "repeat-customer-ceiling", name: "Repeat customer authority", description: "Give verified repeat customers a higher ceiling.", priority: 200, hardConstraint: false, scope: { customerSegments: ["repeat"] }, conditions: [{ field: "customer.segment", operator: "equals", value: "repeat" }], effect: { type: "SET_MAX_DISCOUNT_BPS", valueBps: bps(repeat) } }),
      rule({ id: "minimum-margin-floor", name: "Minimum gross margin", description: "Protect the merchant-defined gross margin floor.", priority: 700, hardConstraint: true, scope: {}, conditions: [], effect: { type: "SET_MIN_MARGIN_BPS", valueBps: bps(margin) } }),
      rule({ id: "low-stock-safety", name: "Low-stock safety", description: "Disable autonomous negotiation when inventory is scarce.", priority: 900, hardConstraint: true, scope: {}, conditions: [{ field: "product.stock", operator: "lessThan", value: lowStock }], effect: { type: "DISABLE_NEGOTIATION" } }),
      rule({ id: "high-value-approval", name: "High-value approval", description: "Require merchant approval for high-value carts.", priority: 600, hardConstraint: false, scope: {}, conditions: [{ field: "cart.totalPaise", operator: "greaterThanOrEqual", value: paiseFromRupees(approval) }], effect: { type: "REQUIRE_APPROVAL" } }),
      rule({ id: "aster-brand-protection", name: "Aster brand protection", description: "Aster products do not receive autonomous discounts.", priority: 950, hardConstraint: true, scope: { brands: ["Aster"] }, conditions: [{ field: "product.brand", operator: "equals", value: "Aster" }], effect: { type: "SET_MAX_DISCOUNT_BPS", valueBps: 0 } }),
      rule({ id: "high-stock-accessories", name: "High-stock accessories", description: "Use available accessory inventory to add three percentage points within all hard caps.", priority: 300, hardConstraint: false, scope: { categories: ["Accessories"] }, conditions: [{ field: "product.category", operator: "equals", value: "Accessories" }, { field: "product.stock", operator: "greaterThan", value: 100 }], effect: { type: "ADD_MAX_DISCOUNT_BPS", valueBps: 300 } }),
    ],
  };

  const validation = validatePolicy(policy);
  const discrepancies = [...validation.discrepancies];

  return {
    source: options?.source ?? "demo-fallback",
    model: options?.model ?? "Deterministic policy compiler",
    workflowName: "Haven Home · Everyday commerce",
    summary: discrepancies.length ? "Policy draft created. Resolve the highlighted discrepancy before publishing." : "Merchant intent compiled into a validated deterministic policy draft.",
    policy,
    graph: policyToGraph(policy),
    discrepancies,
    assumptions: [
      "Catalogue data, customer history, and policy versions are loaded by the server.",
      "Connector capability never grants commercial authority.",
      "Missing cost data fails safe to merchant review when a margin floor applies.",
      "NIM may propose this IR, but a merchant must validate and publish it explicitly.",
    ],
    clarificationQuestions: clarificationQuestions(prompt),
    valid: validation.valid && discrepancies.length === 0,
  } satisfies CompiledPolicyProposal;
}

export function compileDemoPolicyProposal(prompt: string, options?: Omit<Parameters<typeof compilePolicyProposal>[1], "source" | "model">) {
  return compilePolicyProposal(prompt, { ...options, source: "demo-fallback", model: "Deterministic policy compiler" });
}
