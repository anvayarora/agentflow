import { evaluateCommerceAction, type CommerceEvaluation } from "../policy/evaluator";
import { getCommerceRepository } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";

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
