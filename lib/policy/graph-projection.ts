import { sortRulesForEvaluation } from "./precedence";
import type { PolicyVersionIR } from "./schema";

export type PolicyGraphNode = {
  id: string;
  type: "context" | "constraint" | "approval" | "outcome";
  title: string;
  detail: string;
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

export function policyToGraph(policy: PolicyVersionIR): PolicyGraph {
  const rules = sortRulesForEvaluation(policy.rules);
  const nodes: PolicyGraphNode[] = [
    { id: "merchant-context", type: "context", title: "Merchant policy", detail: `${policy.currency} · version ${policy.version}` },
  ];
  const edges: PolicyGraphEdge[] = [];
  let previous = "merchant-context";
  for (const rule of rules) {
    const type = rule.effect.type === "REQUIRE_APPROVAL" ? "approval" : "constraint";
    nodes.push({ id: `rule-${rule.id}`, type, title: rule.name, detail: effectDetail(rule), ruleId: rule.id });
    edges.push({ id: `${previous}-to-rule-${rule.id}`, source: previous, target: `rule-${rule.id}` });
    previous = `rule-${rule.id}`;
  }
  nodes.push({ id: "decision-outcome", type: "outcome", title: "Deterministic outcome", detail: "Allow, counter, escalate, or deny." });
  edges.push({ id: `${previous}-to-decision-outcome`, source: previous, target: "decision-outcome" });
  return { nodes, edges };
}
