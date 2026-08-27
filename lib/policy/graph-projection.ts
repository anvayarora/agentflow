import { sortRulesForEvaluation } from "./precedence";
import type { PolicyVersionIR } from "./schema";

export type PolicyGraphNode = {
  id: string;
  type: "context" | "constraint" | "approval" | "outcome";
  family?: "MERCHANT" | "CUSTOMER" | "CART" | "PRODUCT" | "ECONOMICS" | "GROWTH" | "NEGOTIATION" | "GOVERNANCE" | "PAYMENT" | "AUDIT";
  title: string;
  detail: string;
  config?: Record<string, unknown>;
  ruleId?: string;
};

export type PolicyGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type PolicyGraph = {
  nodes: PolicyGraphNode[];
  edges: PolicyGraphEdge[];
};

function effectDetail(rule: PolicyVersionIR["rules"][number]) {
  switch (rule.effect.type) {
    case "SET_MAX_DISCOUNT_BPS": return `Maximum discount ${rule.effect.valueBps / 100}%.`;
    case "ADD_MAX_DISCOUNT_BPS": return `${rule.effect.valueBps >= 0 ? "+" : ""}${rule.effect.valueBps / 100} percentage points.`;
    case "SET_MIN_MARGIN_BPS": return `Minimum gross margin ${rule.effect.valueBps / 100}%.`;
    case "REQUIRE_APPROVAL": return "Route the decision to merchant approval.";
    case "DENY": return "Deny the commercial action.";
    case "ALLOW_BUNDLE": return "Allow the configured bundle capability.";
    case "SET_QUANTITY_DISCOUNT": return `${rule.effect.discountBps / 100}% at quantity ${rule.effect.quantity}.`;
    case "DISABLE_NEGOTIATION": return "Disable autonomous negotiation.";
  }
}

function familyForRule(rule: PolicyVersionIR["rules"][number]): PolicyGraphNode["family"] {
  if (rule.effect.type === "REQUIRE_APPROVAL") return "GOVERNANCE";
  if (rule.effect.type === "DENY") return "GOVERNANCE";
  if (rule.effect.type === "DISABLE_NEGOTIATION") return "NEGOTIATION";
  if (rule.effect.type === "SET_MIN_MARGIN_BPS") return "ECONOMICS";
  if (rule.effect.type === "ALLOW_BUNDLE") return "GROWTH";
  if (rule.conditions.some((condition) => condition.field.startsWith("customer."))) return "CUSTOMER";
  if (rule.conditions.some((condition) => condition.field.startsWith("cart."))) return "CART";
  if (rule.conditions.some((condition) => condition.field.startsWith("product."))) return "PRODUCT";
  return "ECONOMICS";
}

export function policyToGraph(policy: PolicyVersionIR): PolicyGraph {
  const rules = sortRulesForEvaluation(policy.rules);
  const nodes: PolicyGraphNode[] = [
    { id: "merchant-context", type: "context", family: "MERCHANT", title: "Merchant policy", detail: `${policy.currency} · version ${policy.version}`, config: { policyVersionId: policy.id, status: policy.status } },
  ];
  const edges: PolicyGraphEdge[] = [];
  let previous = "merchant-context";
  for (const rule of rules) {
    const type = rule.effect.type === "REQUIRE_APPROVAL" ? "approval" : "constraint";
    nodes.push({ id: `rule-${rule.id}`, type, family: familyForRule(rule), title: rule.name, detail: effectDetail(rule), config: { priority: rule.priority, hardConstraint: rule.hardConstraint, scope: rule.scope, conditions: rule.conditions, effect: rule.effect }, ruleId: rule.id });
    edges.push({ id: `${previous}-to-rule-${rule.id}`, source: previous, target: `rule-${rule.id}` });
    previous = `rule-${rule.id}`;
  }
  nodes.push({ id: "decision-outcome", type: "outcome", family: "AUDIT", title: "Audit decision", detail: "Allow, counter, escalate, or deny.", config: { source: "policy-runtime" } });
  edges.push({ id: `${previous}-to-decision-outcome`, source: previous, target: "decision-outcome" });
  return { nodes, edges };
}

/** Convert an edited graph projection back into the canonical draft IR. */
export function graphToPolicy(policy: PolicyVersionIR, graph: PolicyGraph): PolicyVersionIR {
  const configByRule = new Map(graph.nodes.filter((node) => node.ruleId && node.config).map((node) => [node.ruleId!, node.config!]));
  const rules = policy.rules.map((rule) => {
    const config = configByRule.get(rule.id);
    if (!config) return rule;
    const next = { ...rule };
    if (typeof config.priority === "number") next.priority = Math.trunc(config.priority);
    if (typeof config.hardConstraint === "boolean") next.hardConstraint = config.hardConstraint;
    if (config.scope && typeof config.scope === "object") next.scope = config.scope as PolicyVersionIR["rules"][number]["scope"];
    if (Array.isArray(config.conditions)) next.conditions = config.conditions as PolicyVersionIR["rules"][number]["conditions"];
    if (config.effect && typeof config.effect === "object") next.effect = config.effect as PolicyVersionIR["rules"][number]["effect"];
    return next;
  });
  return { ...policy, rules };
}
