import { calculateGrossMarginBps } from "../domain/money";
import { toPublicProduct } from "../domain/catalogue";
import { evaluateCommerceAction } from "../policy/evaluator";
import { getCommerceRepository } from "../server/repositories/commerce";
import { getGrowthRepository } from "../server/repositories/growth";
import { getRuntimeStore, runtimeKinds } from "../server/runtime/store";
import type { TrustedRequestContext } from "../server/context";
import type { GrowthOpportunity, GrowthSignal, GrowthOpportunityType } from "./types";

const complementaryCategory: Record<string, string> = { Desks: "Lamps", Chairs: "Accessories", Lamps: "Desks", Accessories: "Desks" };
const now = () => new Date().toISOString();
const signalId = (type: string, productId: string, relatedProductId?: string) => `signal-${type.toLowerCase()}-${productId}${relatedProductId ? `-${relatedProductId}` : ""}`;
const opportunityId = (type: string, productId: string, relatedProductId?: string) => `opportunity-${type.toLowerCase()}-${productId}${relatedProductId ? `-${relatedProductId}` : ""}`;

function minimumMarginBps(policy: Awaited<ReturnType<ReturnType<typeof getCommerceRepository>["getCurrentPolicy"]>>) {
  return policy?.rules.reduce((floor, rule) => rule.effect.type === "SET_MIN_MARGIN_BPS" ? Math.max(floor, rule.effect.valueBps) : floor, 0) || 0;
}

function scoreOpportunity(input: { stock: number; marginHeadroomBps: number; affinity: boolean; risk: number; history: "OBSERVED" | "INSUFFICIENT_HISTORY" }) {
  const inventoryPressure = Math.min(4_000, Math.max(0, input.stock - 40) * 25);
  const marginHeadroom = Math.min(3_000, Math.max(0, input.marginHeadroomBps) / 2);
  const affinity = input.affinity ? 1_500 : 0;
  const historyBonus = input.history === "OBSERVED" ? 1_000 : 0;
  return Math.max(0, Math.min(10_000, Math.round(inventoryPressure + marginHeadroom + affinity + historyBonus - input.risk)));
}

async function recordSignal(context: TrustedRequestContext, signal: Omit<GrowthSignal, "id" | "organizationId" | "calculatedAt"> & { id?: string }) {
  const repository = getGrowthRepository();
  const saved = await repository.upsertSignal(context, { ...signal, id: signal.id, calculatedAt: now() });
  await getCommerceRepository().recordAudit(context, { eventType: "GROWTH_SIGNAL_DETECTED", entityType: "growth_signal", entityId: saved.id, metadata: { type: saved.type, productId: saved.productId, confidenceBps: saved.confidenceBps } });
  return saved;
}

export type GrowthScanResult = {
  calculatedAt: string;
  signals: GrowthSignal[];
  opportunities: GrowthOpportunity[];
  salesHistory: "OBSERVED" | "INSUFFICIENT_HISTORY";
};

export async function scanGrowth(context: TrustedRequestContext): Promise<GrowthScanResult> {
  const commerce = getCommerceRepository();
  const growth = getGrowthRepository();
  const [products, policy, transactions] = await Promise.all([
    commerce.listProducts(context),
    commerce.getCurrentPolicy(context),
    getRuntimeStore().list<Record<string, unknown>>(context, runtimeKinds.transaction, 500),
  ]);
  if (!policy) throw new Error("A published policy is required before growth scanning.");
  const salesHistory: "OBSERVED" | "INSUFFICIENT_HISTORY" = transactions.some((record) => record.payload.status === "PAID" && Array.isArray(record.payload.lineItems)) ? "OBSERVED" : "INSUFFICIENT_HISTORY";
  const floor = minimumMarginBps(policy);
  const signals: GrowthSignal[] = [];
  const opportunities: GrowthOpportunity[] = [];

  for (const product of products) {
    await growth.recordInventorySnapshot(context, { productId: product.id, variantId: String(product.attributes.variantId || product.externalId || product.id), quantity: product.stock, observedAt: now(), source: product.source || "catalogue" });
    if (product.stock < 10) {
      signals.push(await recordSignal(context, { id: signalId("LOW_STOCK", product.id), type: "LOW_STOCK", productId: product.id, severity: "critical", confidenceBps: 10_000, evidence: { stock: product.stock, threshold: 10, dataQuality: "OBSERVED" } }));
      opportunities.push(await growth.createOpportunity(context, {
        id: opportunityId("SUPPRESS_DISCOUNT", product.id), type: "SUPPRESS_DISCOUNT", sourceSignalIds: [signalId("LOW_STOCK", product.id)], primaryProductId: product.id, secondaryProductIds: [], proposedAction: { action: "SUPPRESS_DISCOUNT", reason: "low-stock safety" }, estimatedImpact: { kind: "SIMULATED", description: "Protects scarce inventory rather than estimating revenue." }, evidence: { stock: product.stock, dataQuality: "OBSERVED" }, riskFlags: ["low-stock"], policyCompatibility: "COMPATIBLE", scoreBps: 8_000, status: "READY",
      }));
    }
    if (product.stock >= 100) {
      signals.push(await recordSignal(context, { id: signalId("HIGH_STOCK", product.id), type: "HIGH_STOCK", productId: product.id, severity: "attention", confidenceBps: 10_000, evidence: { stock: product.stock, threshold: 100, dataQuality: "OBSERVED", salesHistory } }));
      const margin = product.costPaise === null ? null : calculateGrossMarginBps(product.listPricePaise, product.costPaise);
      const marginHeadroom = margin === null ? 0 : margin - floor;
      if (margin !== null && margin >= floor) {
        const secondary = products.find((candidate) => candidate.id !== product.id && candidate.category === complementaryCategory[product.category] && candidate.stock > 0);
        const session = { id: `growth:${product.id}`, organizationId: context.organizationId, currency: policy.currency, status: "OPEN", cartTotalPaise: 0 };
        const customer = await commerce.getCustomer(context, "customer-haven-repeat");
        if (customer) {
          const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: 1, requestedDiscountBps: 0 } });
          const type: GrowthOpportunityType = secondary ? "BUNDLE" : "INVENTORY_RECOVERY";
          const signalIds = [signalId("HIGH_STOCK", product.id)];
          if (secondary) {
            const affinitySignal = await recordSignal(context, { id: signalId("STRONG_AFFINITY", product.id, secondary.id), type: "STRONG_AFFINITY", productId: product.id, relatedProductId: secondary.id, severity: "info", confidenceBps: salesHistory === "OBSERVED" ? 6_000 : 1_000, evidence: { method: "deterministic_category_complement", coPurchaseCount: 0, dataQuality: salesHistory } });
            signals.push(affinitySignal); signalIds.push(affinitySignal.id);
          }
          const maxIncentiveBps = evaluation.maxDiscountBps || 0;
          const compatible = evaluation.outcome !== "DENY" && evaluation.outcome !== "ESCALATE";
          const saved = await growth.createOpportunity(context, {
            id: opportunityId(type, product.id, secondary?.id), type, sourceSignalIds: signalIds, primaryProductId: product.id, secondaryProductIds: secondary ? [secondary.id] : [],
            proposedAction: { action: secondary ? "PRIVATE_BUNDLE" : "INVENTORY_RECOVERY", maxIncentiveBps, requiresPolicyRuntime: true },
            estimatedImpact: { kind: "SIMULATED", potentialIncrementalAovPaise: secondary ? Math.round(secondary.listPricePaise * 0.5) : 0, salesHistory },
            evidence: { stock: product.stock, listPricePaise: product.listPricePaise, marginBps: margin, marginFloorBps: floor, dataQuality: "OBSERVED", salesHistory },
            riskFlags: product.costPaise === null ? ["missing-cost"] : [], policyCompatibility: compatible ? "COMPATIBLE" : "REVIEW", scoreBps: scoreOpportunity({ stock: product.stock, marginHeadroomBps: marginHeadroom, affinity: Boolean(secondary), risk: compatible ? 0 : 4_000, history: salesHistory }), status: compatible ? "READY" : "REVIEW",
          });
          opportunities.push(saved);
        }
      }
    }
    if (product.costPaise !== null && product.costPaise < product.listPricePaise) {
      const margin = calculateGrossMarginBps(product.listPricePaise, product.costPaise);
      const type = margin >= floor ? "HIGH_MARGIN" : "LOW_MARGIN";
      signals.push(await recordSignal(context, { id: signalId(type, product.id), type, productId: product.id, severity: margin >= floor ? "info" : "attention", confidenceBps: 10_000, evidence: { marginBps: margin, floorBps: floor, dataQuality: "OBSERVED" } }));
    }
  }
  for (const opportunity of opportunities) await commerce.recordAudit(context, { eventType: "GROWTH_OPPORTUNITY_CREATED", entityType: "growth_opportunity", entityId: opportunity.id, metadata: { type: opportunity.type, scoreBps: opportunity.scoreBps, policyCompatibility: opportunity.policyCompatibility } });
  return { calculatedAt: now(), signals, opportunities, salesHistory };
}

export async function getEligibleGrowthActions(input: { context: TrustedRequestContext; sessionId: string; cartHash?: string | null }) {
  const commerce = getCommerceRepository();
  const growth = getGrowthRepository();
  const session = await commerce.getSession(input.context, input.sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  if (input.cartHash !== undefined && input.cartHash !== session.cartHash) throw new Error("Growth actions are bound to the current cart.");
  const policy = await commerce.getCurrentPolicy(input.context);
  const customer = await commerce.getCustomer(input.context, session.customerId);
  if (!policy || !customer) throw new Error("Current policy and customer context are required.");
  const plays = (await growth.listPlays(input.context)).filter((play) => play.status === "ACTIVE" && (!play.expiresAt || Date.parse(play.expiresAt) > Date.now()));
  const actions = [];
  for (const play of plays) {
    const primary = await commerce.getProduct(input.context, play.primaryProductId);
    if (!primary || primary.stock < 1) continue;
    const evaluation = evaluateCommerceAction({ organizationId: input.context.organizationId, policy, product: primary, customer, session, request: { quantity: 1, requestedDiscountBps: play.maxIncentiveBps } });
    await commerce.recordAudit(input.context, { eventType: "GROWTH_ACTION_EVALUATED", entityType: "growth_play", entityId: play.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { outcome: evaluation.outcome, maxIncentiveBps: play.maxIncentiveBps } });
    if (evaluation.outcome === "DENY" || evaluation.outcome === "ESCALATE" || (typeof evaluation.maxDiscountBps === "number" && play.maxIncentiveBps > evaluation.maxDiscountBps)) {
      await commerce.recordAudit(input.context, { eventType: "GROWTH_ACTION_BLOCKED", entityType: "growth_play", entityId: play.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { outcome: evaluation.outcome, maxIncentiveBps: play.maxIncentiveBps, currentMaxDiscountBps: evaluation.maxDiscountBps } });
      continue;
    }
    await commerce.recordAudit(input.context, { eventType: "GROWTH_ACTION_AUTHORIZED", entityType: "growth_play", entityId: play.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { maxIncentiveBps: play.maxIncentiveBps } });
    actions.push({ playId: play.id, type: play.commercialStrategy.type || "PRIVATE_INCENTIVE", product: toPublicProduct(primary), secondaryProductIds: play.secondaryProductIds, maxIncentiveBps: play.maxIncentiveBps, requiresPolicyRuntime: true });
  }
  return { sessionId: input.sessionId, actions };
}
