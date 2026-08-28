import { getCommerceRepository } from "../server/repositories/commerce";
import { assertMerchantContext, type TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import type { ApprovalPayload, OfferPayload } from "../commerce/offer-service";
import type { PaymentPayload, TransactionPayload } from "../commerce/checkout-service";
import { getGrowthRepository } from "../server/repositories/growth";
import { runRedTeamSuite, type RedTeamCheck } from "../security/red-team";

export type ApprovalQueueFilters = {
  status?: "PENDING" | "APPROVED" | "COUNTERED" | "REJECTED" | "EXPIRED";
  query?: string;
};

function approvalPriority(approval: { payload: ApprovalPayload }, offer?: OfferPayload) {
  if (approval.payload.status !== "PENDING") return 0;
  const expiryUrgency = offer?.expiresAt && Date.parse(offer.expiresAt) - Date.now() < 5 * 60_000 ? 20 : 0;
  const highValue = offer?.requestedUnitPricePaise && offer.quantity * offer.requestedUnitPricePaise >= 5_000_000 ? 40 : 0;
  return 100 + highValue + expiryUrgency;
}

function publicOffer(offer: OfferPayload | undefined, offerId?: string) {
  if (!offer) return null;
  return {
    offerId: offerId || null,
    productId: offer.productId,
    variantId: offer.variantId || null,
    quantity: offer.quantity,
    requestedUnitPricePaise: offer.requestedUnitPricePaise,
    requestedDiscountBps: offer.requestedDiscountBps,
    outcome: offer.outcome,
    approvedPricePaise: offer.approvedPricePaise ?? null,
    counterPricePaise: offer.counterPricePaise ?? null,
    requiresApproval: offer.requiresApproval,
    policyVersionId: offer.policyVersionId,
    policyVersionNumber: offer.policyVersionNumber,
    cartHash: offer.cartHash,
    expiresAt: offer.expiresAt,
    status: offer.status,
  };
}

async function approvalRecord(context: TrustedRequestContext, record: RuntimeRecord<ApprovalPayload>) {
  const approval = record;
  const offerRecord = await getRuntimeStore().get<OfferPayload>(context, runtimeKinds.offer, approval.payload.offerId);
  const offer = offerRecord?.payload;
  const session = await getCommerceRepository().getSession(context, approval.payload.sessionId);
  const customer = session ? await getCommerceRepository().getCustomer(context, session.customerId) : null;
  const product = offer ? await getCommerceRepository().getProduct(context, offer.productId) : null;
  const expired = Boolean(approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now());
  return {
    approvalId: approval.id,
    status: expired && approval.payload.status === "PENDING" ? "EXPIRED" : approval.payload.status,
    priority: approvalPriority(approval, offer),
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    expiresAt: approval.expiresAt || offer?.expiresAt || null,
    decision: approval.payload.decision || null,
    decidedBy: approval.payload.decidedBy || null,
    decidedAt: approval.payload.decidedAt || null,
    session: session ? { id: session.id, customerId: session.customerId, currency: session.currency, cartTotalPaise: session.cartTotalPaise, shopifyShopDomain: session.shopifyShopDomain || null } : null,
    customer: customer ? { id: customer.id, segment: customer.orderCount > 0 ? "repeat" : "new", orderCount: customer.orderCount, lifetimeValuePaise: customer.lifetimeValuePaise } : null,
    product: product ? { id: product.id, sku: product.sku, name: product.name, category: product.category, brand: product.brand, listPricePaise: product.listPricePaise, stock: product.stock } : { id: offer?.productId || "unknown" },
    offer: publicOffer(offer, approval.payload.offerId),
    evidence: offerRecord ? { matchedRules: offer?.matchedRules || [], policyVersionId: offer?.policyVersionId || null, evidence: offer?.evidence || [], explanation: offer?.outcome === "ESCALATE" ? "This request exceeded autonomous authority and is waiting for a merchant decision." : "Review the canonical product, customer, cart, and policy context before deciding." } : null,
  };
}

export async function listApprovalQueue(context: TrustedRequestContext, filters: ApprovalQueueFilters = {}) {
  assertMerchantContext(context);
  const records = await getRuntimeStore().listAll<ApprovalPayload>(context, runtimeKinds.approval);
  const rows = await Promise.all(records.map((record) => approvalRecord(context, record)));
  const query = filters.query?.trim().toLowerCase();
  return rows
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => !query || `${row.approvalId} ${row.product?.name || ""} ${row.product?.sku || ""} ${row.customer?.segment || ""}`.toLowerCase().includes(query))
    .sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
}

export async function getApprovalQueueDetail(context: TrustedRequestContext, approvalId: string) {
  assertMerchantContext(context);
  const record = await getRuntimeStore().get<ApprovalPayload>(context, runtimeKinds.approval, approvalId);
  if (!record) throw new Error("Approval request was not found or has expired.");
  return approvalRecord(context, record);
}

export async function listTransactionOperations(context: TrustedRequestContext) {
  assertMerchantContext(context);
  const store = getRuntimeStore();
  const transactions = await store.list<TransactionPayload>(context, runtimeKinds.transaction, 200);
  const payments = await store.list<PaymentPayload>(context, runtimeKinds.payment, 200);
  const offers = await store.list<OfferPayload>(context, runtimeKinds.offer, 200);
  const attributions = await getGrowthRepository().listAttributions(context);
  const auditEvents = await getCommerceRepository().listAudit(context, 200);
  return Promise.all(transactions.map(async (record) => {
    const transaction = record.payload;
    const payment = payments.find((item) => item.payload.transactionId === record.id);
    const offer = offers.find((item) => item.id === transaction.offerId)?.payload;
    const attribution = attributions.find((item) => item.transactionId === record.id);
    const session = await getCommerceRepository().getSession(context, transaction.sessionId);
    const paymentStatus = payment?.payload.status || "NOT_CREATED";
    const status = transaction.status === "PAID" || transaction.status === "FAILED" ? transaction.status : transaction.status;
    return {
      transactionId: record.id,
      status,
      amountPaise: transaction.amountPaise,
      currency: transaction.currency,
      createdAt: record.createdAt,
      provider: transaction.provider,
      providerOrderId: transaction.providerOrderId || null,
      payment: { status: paymentStatus, providerPaymentId: payment?.payload.providerPaymentId || null, verified: paymentStatus === "PAID" },
      session: session ? { id: session.id, shopifyShopDomain: session.shopifyShopDomain || null, shopifyCartId: session.shopifyCartId || null } : null,
      classification: { aiAssisted: auditEvents.some((event) => event.shoppingSessionId === transaction.sessionId && event.eventType.startsWith("AGENT_")), negotiated: Boolean(offer && offer.requestedDiscountBps > 0), hitl: Boolean(offer?.requiresApproval || offer?.outcome === "ESCALATE"), growthPlay: Boolean(attribution), bundle: Boolean(attribution && attribution.incrementalAovPaise > 0) },
      growthAttribution: attribution ? { ...attribution, state: attribution.verified && paymentStatus === "PAID" ? "VERIFIED" : "POTENTIAL" } : null,
      revenueState: transaction.status === "PAID" && paymentStatus === "PAID" ? "VERIFIED_REVENUE" : "NOT_REVENUE",
    };
  }));
}

export async function getTransactionOperation(context: TrustedRequestContext, transactionId: string) {
  const rows = await listTransactionOperations(context);
  const row = rows.find((item) => item.transactionId === transactionId);
  if (!row) throw new Error("Transaction was not found.");
  const audit = await queryAuditTrail(context, { entityId: transactionId, limit: 200 });
  return { ...row, audit };
}

export type AuditFilters = { correlationId?: string; entityId?: string; transactionId?: string; sessionId?: string; offerId?: string; approvalId?: string; growthPlayId?: string; shopDomain?: string; eventType?: string; actorId?: string; limit?: number };

export async function queryAuditTrail(context: TrustedRequestContext, filters: AuditFilters = {}) {
  assertMerchantContext(context);
  const events = await getCommerceRepository().listAudit(context, Math.min(filters.limit || 200, 200));
  return events.filter((event) => {
    const metadata = event.metadata || {};
    return (!filters.correlationId || event.correlationId === filters.correlationId)
      && (!filters.entityId || event.entityId === filters.entityId)
      && (!filters.transactionId || event.entityId === filters.transactionId || metadata.transactionId === filters.transactionId)
      && (!filters.sessionId || event.shoppingSessionId === filters.sessionId)
      && (!filters.offerId || event.entityId === filters.offerId || metadata.offerId === filters.offerId)
      && (!filters.approvalId || event.entityId === filters.approvalId || metadata.approvalId === filters.approvalId)
      && (!filters.growthPlayId || event.entityId === filters.growthPlayId || metadata.growthPlayId === filters.growthPlayId)
      && (!filters.shopDomain || metadata.shopDomain === filters.shopDomain || metadata.shopifyShopDomain === filters.shopDomain)
      && (!filters.eventType || event.eventType === filters.eventType)
      && (!filters.actorId || event.actorId === filters.actorId);
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((event) => ({ ...event, explanation: explainAuditEvent(event.eventType, event.metadata) }));
}

function explainAuditEvent(eventType: string, metadata: Record<string, unknown>) {
  if (eventType.includes("PAYMENT") || eventType.includes("CHECKOUT")) return "Server-side payment and checkout evidence was recorded; only provider-verified payment states count as revenue.";
  if (eventType.includes("APPROVAL")) return `A merchant approval state changed${metadata.decision ? ` to ${String(metadata.decision)}` : ""}.`;
  if (eventType.includes("GROWTH")) return "Growth activity is attributed to observed or simulated evidence and is separate from realized revenue.";
  if (eventType.includes("AGENT")) return "An agent interaction was recorded without exposing hidden reasoning or private credentials.";
  return "A deterministic AgentFlow event was recorded for this organization.";
}

export async function getGrowthResults(context: TrustedRequestContext) {
  assertMerchantContext(context);
  const growth = getGrowthRepository();
  const [opportunities, plays, attributions] = await Promise.all([growth.listOpportunities(context), growth.listPlays(context), growth.listAttributions(context)]);
  const transactions = await listTransactionOperations(context);
  const paid = transactions.filter((transaction) => transaction.revenueState === "VERIFIED_REVENUE");
  const verifiedAttributions = attributions.filter((item) => item.verified && paid.some((transaction) => transaction.transactionId === item.transactionId));
  const realizedIncrementalAovPaise = verifiedAttributions.reduce((sum, item) => sum + item.incrementalAovPaise, 0);
  return {
    history: paid.length ? "OBSERVED" : "INSUFFICIENT_HISTORY",
    opportunities: opportunities.length,
    activePlays: plays.filter((play) => play.status === "ACTIVE").length,
    labels: { potential: opportunities.length ? "POTENTIAL" : "INSUFFICIENT_HISTORY", simulated: "SIMULATED", realized: verifiedAttributions.length ? "REALIZED" : "INSUFFICIENT_HISTORY", verified: verifiedAttributions.length ? "VERIFIED" : "INSUFFICIENT_HISTORY" },
    funnel: { opportunities: opportunities.length, active: plays.filter((play) => play.status === "ACTIVE").length, attributed: attributions.length, verified: verifiedAttributions.length },
    verifiedPurchases: verifiedAttributions.length,
    realizedAovPaise: realizedIncrementalAovPaise,
    realizedRevenuePaise: paid.reduce((sum, item) => sum + item.amountPaise, 0),
    unitsMoved: verifiedAttributions.length,
    marginSafety: "ENFORCED_BY_POLICY_RUNTIME",
    attributions: attributions.map((item) => ({ ...item, state: item.verified && paid.some((transaction) => transaction.transactionId === item.transactionId) ? "VERIFIED" : "POTENTIAL" })),
  };
}

export async function runMerchantRedTeam(context: TrustedRequestContext) {
  assertMerchantContext(context);
  const result = await runRedTeamSuite(context);
  return { ...result, unauthorizedPaymentCalls: result.unauthorizedPaymentCalls, executedAt: new Date().toISOString() };
}

export type MerchantRedTeamResult = { passed: boolean; checks: RedTeamCheck[]; unauthorizedPaymentCalls: number; executedAt: string };
