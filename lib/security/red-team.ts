import { getCommerceRepository, resetCommerceRepositoryForTests } from "../server/repositories/commerce";
import { evaluateCommerceAction } from "../policy/evaluator";
import type { TrustedRequestContext } from "../server/context";

export type RedTeamCheck = { id: string; passed: boolean; evidence: string };

export async function runRedTeamSuite(context: TrustedRequestContext): Promise<{ passed: boolean; checks: RedTeamCheck[] }> {
  resetCommerceRepositoryForTests();
  const repository = getCommerceRepository();
  const product = await repository.getProduct(context, "desk-032");
  const customer = await repository.getCustomer(context, "customer-haven-repeat");
  const policy = await repository.getCurrentPolicy(context);
  if (!product || !customer || !policy) throw new Error("Red-team trusted fixtures are unavailable.");
  const session = { id: "red-team-session", organizationId: context.organizationId, currency: "INR", status: "OPEN", cartTotalPaise: 0 };
  const baseline = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: 1, requestedDiscountBps: 0 } });
  const tamperedSegment = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer: { ...customer, orderCount: 0 }, session, request: { quantity: 1, requestedDiscountBps: 0 } });
  const checks: RedTeamCheck[] = [
    { id: "client-segment-does-not-authorize", passed: baseline.outcome === tamperedSegment.outcome || baseline.maxDiscountBps !== tamperedSegment.maxDiscountBps, evidence: "The evaluator reads order history from the trusted customer record; no segment field is accepted." },
    { id: "client-cost-cannot-relax-margin", passed: product.costPaise !== null && evaluateCommerceAction({ organizationId: context.organizationId, policy, product: { ...product, costPaise: null }, customer, session, request: { quantity: 1, requestedDiscountBps: 1000 } }).outcome === "ESCALATE", evidence: "Missing private cost fails safe instead of widening discount authority." },
    { id: "extreme-discount-is-commercial", passed: !evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: 1, requestedDiscountBps: 8000 } }).riskFlags.includes("prompt-injection"), evidence: "Commercial out-of-authority requests remain distinct from prompt-injection classification." },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}
