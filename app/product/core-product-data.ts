import { getGrowthResults, listApprovalQueue, listTransactionOperations, queryAuditTrail } from "../../lib/merchant/operations";
import { policyToGraph } from "../../lib/policy/graph-projection";
import { getCommerceRepository } from "../../lib/server/repositories/commerce";
import { getGrowthRepository } from "../../lib/server/repositories/growth";
import { getSalespersonRepository } from "../../lib/server/repositories/salesperson";
import { getTrustedRequestContext } from "../../lib/server/context";

export type CoreProductApproval = {
  id: string;
  status: string;
  priority: "High" | "Medium";
  productName: string;
  customerSegment: string;
  requestedDiscountBps: number;
  createdAt: string;
  reason: string;
};

export type CoreProductTransaction = {
  id: string;
  status: string;
  amountPaise: number;
  currency: string;
  createdAt: string;
  paymentStatus: string;
  revenueState: string;
};

export type CoreProductActivity = {
  id: string;
  eventType: string;
  createdAt: string;
  explanation: string;
};

export type CoreProductPolicyNode = {
  id: string;
  type: "context" | "constraint" | "approval" | "outcome";
  family: string;
  title: string;
  detail: string;
  priority: number | null;
  hardConstraint: boolean;
};

export type CoreProductOpportunity = {
  id: string;
  type: string;
  title: string;
  productName: string;
  productImageUrl: string | null;
  scoreBps: number;
  status: string;
  policyCompatibility: string;
  impactPaise: number | null;
  evidenceCount: number;
  riskFlags: string[];
  updatedAt: string;
};

export type CoreProductSignal = {
  id: string;
  type: string;
  productName: string;
  severity: string;
  confidenceBps: number;
  calculatedAt: string;
};

export type CoreProductPlay = {
  id: string;
  opportunityId: string;
  productName: string;
  status: string;
  maxIncentiveBps: number;
  minimumMarginBps: number;
  updatedAt: string;
};

export type CoreProductSalesperson = {
  id: string;
  displayName: string;
  description: string;
  languages: string[];
  isActive: boolean;
  isDefault: boolean;
};

export type CoreProductData = {
  policyVersion: number | null;
  policyStatus: string;
  policyNodes: CoreProductPolicyNode[];
  catalogueCount: number;
  simulationProductId: string | null;
  activityCount: number;
  aiConversationCount: number;
  approvals: CoreProductApproval[];
  transactions: CoreProductTransaction[];
  activities: CoreProductActivity[];
  trend: Array<{ date: string; events: number }>;
  growth: {
    opportunities: number;
    activePlays: number;
    verifiedPurchases: number;
    realizedRevenuePaise: number;
    history: string;
    opportunitiesList: CoreProductOpportunity[];
    plays: CoreProductPlay[];
    signals: CoreProductSignal[];
  };
  salespeople: CoreProductSalesperson[];
};

const emptyData = (): CoreProductData => ({
  policyVersion: null,
  policyStatus: "UNAVAILABLE",
  policyNodes: [],
    catalogueCount: 0,
    simulationProductId: null,
  activityCount: 0,
  aiConversationCount: 0,
  approvals: [],
  transactions: [],
  activities: [],
  trend: [],
  growth: { opportunities: 0, activePlays: 0, verifiedPurchases: 0, realizedRevenuePaise: 0, history: "INSUFFICIENT_HISTORY", opportunitiesList: [], plays: [], signals: [] },
  salespeople: [],
});

function numericEvidence(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) return candidate;
  }
  return null;
}

/**
 * Server-only view model for the product workspace. The client receives a
 * deliberately small, display-safe projection; authority remains in the
 * merchant services and policy runtime.
 */
export async function loadCoreProductData(): Promise<CoreProductData> {
  const context = getTrustedRequestContext();
  const commerce = getCommerceRepository();
  const growthRepository = getGrowthRepository();
  const [policy, approvals, transactions, growth, audit, opportunities, plays, signals, products, salespeople] = await Promise.all([
    commerce.getCurrentPolicy(context).catch(() => null),
    listApprovalQueue(context).catch(() => []),
    listTransactionOperations(context).catch(() => []),
    getGrowthResults(context).catch(() => emptyData().growth),
    queryAuditTrail(context, { limit: 200 }).catch(() => []),
    growthRepository.listOpportunities(context).catch(() => []),
    growthRepository.listPlays(context).catch(() => []),
    growthRepository.listSignals(context).catch(() => []),
    commerce.listProducts(context).catch(() => []),
    getSalespersonRepository().list(context).catch(() => []),
  ]);

  const productsById = new Map(products.map((product) => [product.id, product]));
  const policyNodes = policy ? policyToGraph(policy).nodes.map((node) => ({
    id: node.id,
    type: node.type,
    family: node.family || "GOVERNANCE",
    title: node.title,
    detail: node.detail,
    priority: typeof node.config?.priority === "number" ? node.config.priority : null,
    hardConstraint: node.config?.hardConstraint === true,
  })) : [];

  const trend = Object.entries(audit.reduce<Record<string, number>>((accumulator, event) => {
    const day = new Date(event.createdAt).toISOString().slice(5, 10);
    accumulator[day] = (accumulator[day] || 0) + 1;
    return accumulator;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).slice(-7).map(([date, events]) => ({ date, events }));

  return {
    policyVersion: policy?.version ?? null,
    policyStatus: policy?.status ?? "UNAVAILABLE",
    policyNodes,
    catalogueCount: products.length,
    simulationProductId: products.find((product) => /walnut compact desk/i.test(product.name))?.id || products[0]?.id || null,
    activityCount: audit.length,
    aiConversationCount: audit.filter((event) => event.eventType.includes("AGENT") || event.eventType.includes("VOICE")).length,
    approvals: approvals.slice(0, 20).map((approval) => ({
      id: approval.approvalId,
      status: approval.status,
      priority: approval.priority >= 140 ? "High" : "Medium",
      productName: approval.product?.name || "Commerce request",
      customerSegment: approval.customer?.segment || "unknown",
      requestedDiscountBps: approval.offer?.requestedDiscountBps || 0,
      createdAt: approval.createdAt,
      reason: approval.evidence?.explanation || "Review the server-evaluated policy evidence before deciding.",
    })),
    transactions: transactions.slice(0, 20).map((transaction) => ({
      id: transaction.transactionId,
      status: transaction.status,
      amountPaise: transaction.amountPaise,
      currency: transaction.currency,
      createdAt: transaction.createdAt,
      paymentStatus: transaction.payment.status,
      revenueState: transaction.revenueState,
    })),
    activities: audit.slice(0, 20).map((event) => ({ id: event.id, eventType: event.eventType, createdAt: event.createdAt, explanation: event.explanation })),
    trend,
    growth: {
      opportunities: growth.opportunities,
      activePlays: growth.activePlays,
      verifiedPurchases: growth.verifiedPurchases,
      realizedRevenuePaise: growth.realizedRevenuePaise,
      history: growth.history,
      opportunitiesList: opportunities.slice(0, 12).map((opportunity) => {
        const product = productsById.get(opportunity.primaryProductId);
        return {
          id: opportunity.id,
          type: opportunity.type,
          title: opportunity.type.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
          productName: product?.name || "Connected catalogue item",
          productImageUrl: product?.imageUrl || null,
          scoreBps: opportunity.scoreBps,
          status: opportunity.status,
          policyCompatibility: opportunity.policyCompatibility,
          impactPaise: numericEvidence(opportunity.estimatedImpact, ["incrementalAovPaise", "estimatedRevenuePaise", "revenuePaise", "impactPaise"]),
          evidenceCount: Object.keys(opportunity.evidence).length,
          riskFlags: opportunity.riskFlags,
          updatedAt: opportunity.updatedAt,
        };
      }),
      plays: plays.slice(0, 12).map((play) => ({
        id: play.id,
        opportunityId: play.opportunityId,
        productName: productsById.get(play.primaryProductId)?.name || "Connected catalogue item",
        status: play.status,
        maxIncentiveBps: play.maxIncentiveBps,
        minimumMarginBps: play.minimumMarginBps,
        updatedAt: play.updatedAt,
      })),
      signals: signals.slice(0, 12).map((signal) => ({
        id: signal.id,
        type: signal.type,
        productName: signal.productId ? productsById.get(signal.productId)?.name || "Connected catalogue item" : "Store-wide signal",
        severity: signal.severity,
        confidenceBps: signal.confidenceBps,
        calculatedAt: signal.calculatedAt,
      })),
    },
    salespeople: salespeople.map((profile) => ({ id: profile.id, displayName: profile.displayName, description: profile.description, languages: [...profile.languageSupport], isActive: profile.isActive, isDefault: profile.isMerchantDefault })),
  };
}
