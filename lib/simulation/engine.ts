import { evaluateCommerceAction, type CommerceEvaluation } from "../policy/evaluator";
import { getCommerceRepository } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { diffPolicyVersions, type PolicyDiff } from "../policy/diff";

export type SimulationCase = { id: string; productId: string; customerId?: string; quantity: number; requestedDiscountBps?: number; requestedPricePaise?: number };
export type SimulationResult = { caseId: string; outcome: CommerceEvaluation["outcome"]; maxDiscountBps?: number; policyVersionId: string; riskFlags: string[] };

export async function runSimulation(context: TrustedRequestContext, cases: SimulationCase[]) {
  const repository = getCommerceRepository();
  const policy = await repository.getCurrentPolicy(context);
  if (!policy) throw new Error("Published policy is unavailable for simulation.");
  const results: SimulationResult[] = [];
  for (const item of cases.slice(0, 500)) {
    const product = await repository.getProduct(context, item.productId);
    const customer = await repository.getCustomer(context, item.customerId);
    if (!product || !customer) { results.push({ caseId: item.id, outcome: "DENY", policyVersionId: policy.id, riskFlags: ["trusted-context-missing"] }); continue; }
    const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session: { id: `simulation:${item.id}`, organizationId: context.organizationId, currency: policy.currency, status: "OPEN", cartTotalPaise: 0 }, request: { quantity: item.quantity, requestedDiscountBps: item.requestedDiscountBps, requestedPricePaise: item.requestedPricePaise } });
    results.push({ caseId: item.id, outcome: evaluation.outcome, maxDiscountBps: evaluation.maxDiscountBps, policyVersionId: evaluation.policyVersionId, riskFlags: evaluation.riskFlags });
  }
  const id = `simulation-${crypto.randomUUID()}`;
  const record: RuntimeRecord<{ policyVersionId: string; results: SimulationResult[]; createdAt: string }> = { id, organizationId: context.organizationId, kind: runtimeKinds.simulation, status: "COMPLETED", payload: { policyVersionId: policy.id, results, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await getRuntimeStore().put(context, record);
  await repository.recordAudit(context, { eventType: "POLICY_EVALUATED", entityType: "simulation_run", entityId: id, policyVersionId: policy.id, metadata: { caseCount: results.length } });
  return { simulationId: id, policyVersionId: policy.id, results };
}

export async function comparePolicySimulation(context: TrustedRequestContext, draftId: string, cases: SimulationCase[]) {
  const repository = getCommerceRepository();
  const [published, draft] = await Promise.all([repository.getCurrentPolicy(context), repository.getPolicyVersion(context, draftId)]);
  if (!published || !draft || draft.status !== "DRAFT") throw new Error("A published policy and draft policy are required for comparison.");
  const baseline: Record<string, number> = { ALLOW: 0, COUNTER: 0, ESCALATE: 0, DENY: 0 };
  const next: Record<string, number> = { ALLOW: 0, COUNTER: 0, ESCALATE: 0, DENY: 0 };
  for (const item of cases.slice(0, 500)) {
    const product = await repository.getProduct(context, item.productId);
    const customer = await repository.getCustomer(context, item.customerId);
    if (!product || !customer) { baseline.DENY += 1; next.DENY += 1; continue; }
    const baseInput = { organizationId: context.organizationId, product, customer, session: { id: `simulation:${item.id}`, organizationId: context.organizationId, currency: published.currency, status: "OPEN", cartTotalPaise: 0 }, request: { quantity: item.quantity, requestedDiscountBps: item.requestedDiscountBps, requestedPricePaise: item.requestedPricePaise } };
    baseline[evaluateCommerceAction({ ...baseInput, policy: published }).outcome] += 1;
    next[evaluateCommerceAction({ ...baseInput, policy: draft }).outcome] += 1;
  }
  const policyDiff: PolicyDiff = diffPolicyVersions(published, draft);
  const result = { kind: "SIMULATED" as const, policyDiff, outcomeDiff: { baseline, draft: next, cases: cases.length, kind: "SIMULATED" as const }, labels: { observed: ["catalogue", "private economics"], simulated: ["policy outcomes", "discount behavior"] } };
  await repository.recordAudit(context, { eventType: "POLICY_SIMULATED", entityType: "policy_comparison", entityId: draft.id, policyVersionId: draft.id, metadata: { cases: cases.length, from: published.id, to: draft.id } });
  return result;
}
