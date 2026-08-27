import { evaluateCommerceAction } from "../policy/evaluator";
import { getCommerceRepository } from "../server/repositories/commerce";
import { getGrowthRepository } from "../server/repositories/growth";
import type { TrustedRequestContext } from "../server/context";
import { growthPlaySchema, type GrowthPlay } from "./types";

export function negotiationAllowed(requestCount: number, maxOfferRequestsPerSession = 2) {
  return Number.isSafeInteger(requestCount) && requestCount >= 0 && requestCount < maxOfferRequestsPerSession;
}

export async function createGrowthPlay(context: TrustedRequestContext, opportunityId: string, input?: { maxIncentiveBps?: number; expiresAt?: string | null }) {
  const growth = getGrowthRepository();
  const opportunity = await growth.getOpportunity(context, opportunityId);
  if (!opportunity) throw new Error("Growth opportunity was not found in this organization.");
  if (opportunity.status === "DISMISSED" || opportunity.policyCompatibility === "INCOMPATIBLE") throw new Error("This growth opportunity is not eligible for activation.");
  const policy = await getCommerceRepository().getCurrentPolicy(context);
  if (!policy) throw new Error("A published policy is required before creating a growth play.");
  const floor = policy.rules.reduce((value, rule) => rule.effect.type === "SET_MIN_MARGIN_BPS" ? Math.max(value, rule.effect.valueBps) : value, 0);
  const proposedMax = input?.maxIncentiveBps ?? Number(opportunity.proposedAction.maxIncentiveBps || 0);
  if (!Number.isSafeInteger(proposedMax) || proposedMax < 0 || proposedMax > 10_000) throw new Error("Growth incentive must be a percentage in basis points.");
  const play = await growth.createPlay(context, {
    opportunityId: opportunity.id, primaryProductId: opportunity.primaryProductId, secondaryProductIds: opportunity.secondaryProductIds, eligibility: { sessionScoped: true, cartScoped: true, productScoped: true }, commercialStrategy: { type: opportunity.type, requestedDiscountBps: proposedMax, requiresPolicyRuntime: true }, maxIncentiveBps: proposedMax, minimumMarginBps: floor, requiredPolicyChecks: ["published_policy", "canonical_product", "current_stock", "margin_floor", "cart_binding"], customerEligibility: { segments: ["new", "repeat"], sensitiveAttributesUsed: false }, frequencyLimit: { maxOfferRequestsPerSession: 2, cooldownSeconds: 60 }, expiresAt: input?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), approvalRequired: false, status: "DRAFT",
  });
  await getCommerceRepository().recordAudit(context, { eventType: "GROWTH_PLAY_CREATED", entityType: "growth_play", entityId: play.id, metadata: { opportunityId, maxIncentiveBps: proposedMax } });
  return play;
}

export async function simulateGrowthPlay(context: TrustedRequestContext, playId: string) {
  const growth = getGrowthRepository();
  const commerce = getCommerceRepository();
  const play = await growth.getPlay(context, playId);
  if (!play) throw new Error("Growth play was not found in this organization.");
  const policy = await commerce.getCurrentPolicy(context);
  const product = await commerce.getProduct(context, play.primaryProductId);
  const customer = await commerce.getCustomer(context, "customer-haven-repeat");
  if (!policy || !product || !customer) throw new Error("Trusted growth simulation context is incomplete.");
  const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session: { id: `growth-simulation:${play.id}`, organizationId: context.organizationId, currency: policy.currency, status: "OPEN", cartTotalPaise: 0 }, request: { quantity: 1, requestedDiscountBps: play.maxIncentiveBps } });
  const result = { kind: "SIMULATED" as const, playId, policyVersionId: policy.id, outcome: evaluation.outcome, observed: { listPricePaise: product.listPricePaise, stock: product.stock }, synthetic: { requestedDiscountBps: play.maxIncentiveBps, approvedPricePaise: evaluation.approvedPricePaise || evaluation.counterPricePaise || null }, revenueStatus: "NOT_REALIZED" as const };
  const updated = await growth.updatePlayStatus(context, playId, "SIMULATED");
  await commerce.recordAudit(context, { eventType: "GROWTH_PLAY_SIMULATED", entityType: "growth_play", entityId: playId, policyVersionId: policy.id, metadata: result });
  return { play: updated || play, result };
}

export async function activateGrowthPlay(context: TrustedRequestContext, playId: string) {
  const growth = getGrowthRepository();
  const commerce = getCommerceRepository();
  const play = await growth.getPlay(context, playId);
  if (!play) throw new Error("Growth play was not found in this organization.");
  const policy = await commerce.getCurrentPolicy(context);
  const product = await commerce.getProduct(context, play.primaryProductId);
  const customer = await commerce.getCustomer(context, "customer-haven-repeat");
  if (!policy || !product || !customer) throw new Error("Trusted activation context is incomplete.");
  const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session: { id: `growth-activation:${play.id}`, organizationId: context.organizationId, currency: policy.currency, status: "OPEN", cartTotalPaise: 0 }, request: { quantity: 1, requestedDiscountBps: play.maxIncentiveBps } });
  if (evaluation.outcome === "DENY" || evaluation.outcome === "ESCALATE") throw new Error("Published policy did not authorize this growth play.");
  const active = await growth.updatePlayStatus(context, playId, "ACTIVE");
  await commerce.recordAudit(context, { eventType: "GROWTH_PLAY_ACTIVATED", entityType: "growth_play", entityId: playId, policyVersionId: policy.id, metadata: { maxIncentiveBps: play.maxIncentiveBps, policyOutcome: evaluation.outcome } });
  return active || play;
}

export async function updateGrowthPlayStatus(context: TrustedRequestContext, playId: string, status: "PAUSED" | "DISMISSED") {
  const updated = await getGrowthRepository().updatePlayStatus(context, playId, status);
  if (!updated) throw new Error("Growth play was not found in this organization.");
  await getCommerceRepository().recordAudit(context, { eventType: status === "PAUSED" ? "GROWTH_PLAY_PAUSED" : "GROWTH_PLAY_DISMISSED", entityType: "growth_play", entityId: playId, metadata: { status } });
  return growthPlaySchema.parse(updated) satisfies GrowthPlay;
}
