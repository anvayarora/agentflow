import { getGrowthResults, listApprovalQueue, listTransactionOperations, queryAuditTrail } from "../../lib/merchant/operations";
import { getCommerceRepository } from "../../lib/server/repositories/commerce";
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

export type CoreProductData = {
  policyVersion: number | null;
  policyStatus: string;
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
  };
};

const emptyData = (): CoreProductData => ({
  policyVersion: null,
  policyStatus: "UNAVAILABLE",
  approvals: [],
  transactions: [],
  activities: [],
  trend: [],
  growth: { opportunities: 0, activePlays: 0, verifiedPurchases: 0, realizedRevenuePaise: 0, history: "INSUFFICIENT_HISTORY" },
});

/**
 * Server-only view model for the product workspace. The client receives a
 * deliberately small, display-safe projection; authority remains in the
 * merchant services and policy runtime.
 */
export async function loadCoreProductData(): Promise<CoreProductData> {
  const context = getTrustedRequestContext();
  const [policy, approvals, transactions, growth, audit] = await Promise.all([
    getCommerceRepository().getCurrentPolicy(context).catch(() => null),
    listApprovalQueue(context).catch(() => []),
    listTransactionOperations(context).catch(() => []),
    getGrowthResults(context).catch(() => emptyData().growth),
    queryAuditTrail(context, { limit: 200 }).catch(() => []),
  ]);

  const trend = Object.entries(audit.reduce<Record<string, number>>((accumulator, event) => {
    const day = new Date(event.createdAt).toISOString().slice(5, 10);
    accumulator[day] = (accumulator[day] || 0) + 1;
    return accumulator;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).slice(-7).map(([date, events]) => ({ date, events }));

  return {
    policyVersion: policy?.version ?? null,
    policyStatus: policy?.status ?? "UNAVAILABLE",
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
    activities: audit.slice(0, 8).map((event) => ({ id: event.id, eventType: event.eventType, createdAt: event.createdAt, explanation: event.explanation })),
    trend,
    growth: {
      opportunities: growth.opportunities,
      activePlays: growth.activePlays,
      verifiedPurchases: growth.verifiedPurchases,
      realizedRevenuePaise: growth.realizedRevenuePaise,
      history: growth.history,
    },
  };
}
