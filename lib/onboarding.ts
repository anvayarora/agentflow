import { compileDemoPolicyProposal, type CompiledPolicyProposal } from "./policy/compiler";
import type { PolicyVersionIR } from "./policy/schema";
import type { PolicyDiscrepancy } from "./policy/validator";

export type PolicyBlockType = "context" | "constraint" | "approval" | "connector" | "outcome";

export type PolicyBlock = {
  id: string;
  type: PolicyBlockType;
  title: string;
  detail: string;
  source: string;
  status: "ready" | "needs-review";
  ruleId?: string;
};

export type CompiledOnboarding = Omit<CompiledPolicyProposal, "graph"> & {
  draftId?: string;
  blocks: PolicyBlock[];
};

function toBlocks(proposal: CompiledPolicyProposal): PolicyBlock[] {
  return proposal.graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    detail: node.detail,
    source: node.ruleId || "policy.runtime",
    status: proposal.discrepancies.length && node.ruleId && proposal.discrepancies.some((item) => item.relatedRuleIds.includes(node.ruleId || "")) ? "needs-review" : "ready",
    ruleId: node.ruleId,
  }));
}

export function compileDemoOnboarding(prompt: string, options?: { organizationId?: string; policyId?: string; version?: number }): CompiledOnboarding {
  const proposal = compileDemoPolicyProposal(prompt, options);
  return { ...proposal, blocks: toBlocks(proposal) };
}

export function onboardingFromProposal(proposal: CompiledPolicyProposal, draftId?: string): CompiledOnboarding {
  return { ...proposal, draftId, blocks: toBlocks(proposal) };
}

export type { PolicyDiscrepancy, PolicyVersionIR };

export function isCompiledOnboarding(value: unknown): value is CompiledOnboarding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompiledOnboarding>;
  return typeof candidate.summary === "string" && typeof candidate.workflowName === "string" && Array.isArray(candidate.blocks) && Array.isArray(candidate.discrepancies) && Boolean(candidate.policy);
}
